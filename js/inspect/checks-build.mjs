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
import { CONFIG, makeCfg } from '../build/source.mjs';
import { hostCatalogsNatively, resolvePath } from '../hosts/hosts.mjs';
import { EMIT_HOST_SCOPE, footprintOfDir, themeFiles } from '../hosts/installs.mjs';
import { isVendoredPath } from '../hosts/native.mjs';
import { PALETTE_ROLES, colorThemeFiles } from '../hosts/opencode.mjs';
import { readText, withDiscardableStderr } from '../lib/fs.mjs';
import { parseJson, formatRepr } from '../lib/json.mjs';
import {
  ABS_LINK_RE, LINK_RE, TOKEN_RE, has, isDir, isFile, rglob, stemOf, stripCode, within,
} from './scan.mjs';
import { existsSync, readFileSync } from 'node:fs';

// --------------------------------------------------------------------------------------
// the checks
// --------------------------------------------------------------------------------------

/**
 * `_harness_build._link_problems` — dead links AND non-hermetic ones.
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
    // `(md.parent / raw).resolve()` — `resolvePath`, not `path.resolve`, because Python's
    // canonicalises the symlinks in the part that exists and this comparison is against an
    // `out` that went through the same call.
    const target = resolvePath(path.join(path.dirname(md), raw));
    if (!existsSync(target)) problems.push(`dead link '${link}' in ${rel}`);
    else if (!within(target, out)) {
      problems.push(`non-hermetic link '${link}' escapes the bundle in ${rel}`);
    }
  }
  return problems;
}

/**
 * `_harness_build._check_build` — scan one rendered tree for unresolved tokens and bad links.
 *
 * `isVendored` decides which relative shape counts as a vendored folder, and the two callers
 * pass different ones ON PURPOSE: a `files`/opencode-global bundle nests skills at
 * `skills/<name>/…` and a per-repo native layer one level deeper at `.claude/skills/<name>/…`.
 * Vendored folders are verbatim upstream docs carrying their own license, and their internal
 * cross-links point at the upstream project's own files, so they are exempt.
 *
 * `rel` is `str(Path)`, i.e. the platform's separator, because that is what the Python prints
 * — every emit-scan cell in the acceptance matrix names a backslash on Windows.
 */
export function checkBuild(themeName, out, isVendored = isVendoredPath) {
  const outAbs = resolvePath(out);
  const problems = [];
  for (const md of rglob(outAbs)) {
    if (!md.endsWith('.md') || !isFile(md)) continue;
    const rel = path.relative(outAbs, md);
    if (isVendored(rel)) continue;
    const text = readText(md);
    // `set(TOKEN_RE.findall(text))` — Python iterates the set in ITS order, and the whole
    // list is sorted by `_doctor_collect` before printing, so only uniqueness travels.
    for (const tok of new Set(text.match(TOKEN_RE) ?? [])) {
      problems.push(`[${themeName}] unresolved token ${tok} in ${rel}`);
    }
    for (const p of linkProblems(md, text, outAbs, rel)) problems.push(`[${themeName}] ${p}`);
  }
  return problems;
}

/**
 * `_harness_build._theme_parity_problems` — every theme defines the same VOICE keys.
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

/** `_harness_build._HEX_RE`. Anchored at BOTH ends, so `#12345` and `#1122334` both fail. */
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

/**
 * `_harness_build._color_theme_problems` — every curated colour theme carries the full
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
 * `_harness_build._rendered_problems` — a committed bundle must match a fresh render of
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
 * rendered, so they are not in the render set and are correctly ignored. Notebook files
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
  const host = (EMIT_HOST_SCOPE.get(emit) ?? ['', ''])[0];
  let items;
  try {
    // THE FIRST CALLER IN THE PORT THAT CATCHES A REFUSAL, and that is why the stderr is
    // buffered. `sys.exit(msg)` attaches the message to the EXCEPTION and the interpreter
    // prints it on the way out, so a Python caller that catches SystemExit sees no output at
    // all; this port's convention is to write at the raise site (`loadTheme`, and its
    // docblock says why), which is identical for every caller that lets the throw propagate
    // and wrong for exactly this one. Buffered and replayed on success, so a WARN the render
    // legitimately emits still reaches the user, and discarded with the refusal it belongs to.
    ({ items } = withDiscardableStderr(() => renderAll(cfg, themeName, {
      footprint: footprintOfDir(bundle), nativeCatalog: hostCatalogsNatively(host),
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
        ? stripCapabilityLinks(cfg, rendered) : rendered;
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

