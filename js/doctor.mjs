/**
 * `_harness_build.cmd_doctor` — validate the build.
 *
 * Fifteen `_*_problems` checks over one theme (or every theme), and `[doctor] ok — …` when
 * all fifteen find nothing. That last sentence is why this module's gate looks the way it
 * does, and it is worth stating here rather than only in the spec: **delete any single check
 * and a clean run is byte-identical**, so a cross-implementation comparison cannot tell this
 * file from a stub that prints the OK line. `tests/harness_golden.py` therefore plants ONE
 * FAULT PER CHECK, in a private copy of the checkout — see `_copy_checkout` there for why a
 * verb that reads `ROOT` needed a fixture kind that did not exist until this phase.
 *
 * WHY THIS IS THE VERB THAT SPAWNS. `bin/geneseed-cli.mjs` was under a blanket transitive
 * `child_process` ban, and its own docblock predicted the day a verb that genuinely spawns
 * would land: this is it. `_authoring_problems` runs `node --check` over the OpenCode
 * plugins, and there is no in-process equivalent — `vm.Script` compiles as a SCRIPT and every
 * plugin is ESM (`import { promises as fs } from "node:fs"`), which `node --check` accepts
 * through module-syntax detection and `vm.Script` rejects with a SyntaxError of its own. So
 * the ban becomes an ALLOW-LIST of exactly the shape the hook entry already carries for
 * `$GENESEED_LLM`: one binding, one call site, and a test that names the argv. What the ban
 * was actually protecting — that the port never shells back to Python or to the generator —
 * is now asserted directly instead of as a side effect.
 *
 * WHAT IT DOES NOT REACH, MEASURED RATHER THAN ASSUMED. `_doctor_collect` takes `on_progress`
 * and `groups`; `cmd_doctor` passes neither, and they are the TUI's and the web's. The naive
 * closure walk counts ~140 lines of curses drawing behind the first and a structured-view
 * accumulator behind the second. `_ran` is reproduced here anyway, because it is four lines
 * and dropping it would make P6's port of `_doctor_collect` a rewrite rather than a
 * parameter; the progress callback is not, because nothing in this entry can supply one.
 */
import { existsSync, readFileSync, readdirSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

import { CONFIG, PLUGIN_SRC, ROOT, SRC, THEMES, WORKFLOW_SRC, makeCfg } from './checkout.mjs';
import { main as driverMain, emitGlobalInto, emitProjectInto } from '../bin/geneseed.mjs';
import { stripCapabilityLinks } from './emit.mjs';
import { hostCatalogsNatively, pyResolve } from './hosts.mjs';
import { EMIT_HOST_SCOPE, footprintOfDir, installedDefaults, themeFiles } from './installs.mjs';
import {
  ENTITY_STATUSES, LAW_CLASS, LAW_CLASSES, SKILL_CLASS,
} from './inventory.mjs';
import {
  VENDORED_SKILL_DIRS, descBlockProblem, firstBlockquote, isVendoredPath, validateIsVendored,
} from './native.mjs';
import { PALETTE_ROLES, colorThemeFiles } from './opencode.mjs';
import { STRUCTURE, renderAll } from './render.mjs';
import { hookShimPath } from './settings.mjs';
import { pySplitLines } from './lib/pydiff.mjs';
import {
  comparePaths, normcase, parseJson, pyPrint, pyRepr, pyStr, pyWhich, readText,
} from './lib/pyfs.mjs';

// --------------------------------------------------------------------------------------
// _harness_core's scanning primitives
// --------------------------------------------------------------------------------------

/** `_harness_core.TOKEN_RE` / `LINK_RE` / `ABS_LINK_RE`. `g` where `findall` is used. */
const TOKEN_RE = /\{\{[A-Z_]+\}\}/g;
const LINK_RE = /\]\((?!https?:\/\/|#)([^)]+)\)/g;
const ABS_LINK_RE = /^([A-Za-z]:[\\/]|\/|~)/;
const FENCE_RE = /```[\s\S]*?```/g;
const INLINE_CODE_RE = /`[^`]*`/g;
const COMMENT_RE = /<!--[\s\S]*?-->/g;

/** `_harness_core.strip_code` — fenced blocks, inline code and HTML comments, in that order. */
function stripCode(text) {
  return text.replace(FENCE_RE, '').replace(COMMENT_RE, '').replace(INLINE_CODE_RE, '');
}

/**
 * `_harness_core._within` — `child.relative_to(parent)` without the exception.
 *
 * Segment-wise and through `normcase`, because that is what `PurePath` comparison does: a
 * bundle at `C:\Temp\X` contains `c:\temp\x\a.md` on Windows and does not on Linux. A
 * `startsWith` on the raw strings would additionally call `/tmp/bundle2` a child of
 * `/tmp/bundle`, which is the classic version of this bug.
 */
function within(child, parent) {
  const c = normcase(child).split(/[\\/]/);
  const p = normcase(parent).split(/[\\/]/);
  return p.length <= c.length && p.every((seg, i) => c[i] === seg);
}

const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };
const isFile = (p) => { try { return statSync(p).isFile(); } catch { return false; } };

/** `sorted(d.glob(pat))`, or `[]` for a directory that is not there. */
function globSorted(dir, filter) {
  let names;
  try { names = readdirSync(dir); } catch { return []; }
  return names.filter(filter).map((n) => path.join(dir, n)).sort(comparePaths);
}

/** `Path.rglob('*')` — every entry under `dir`, sorted as `sorted()` sorts paths. */
function rglob(dir) {
  const out = [];
  const walk = (d) => {
    let entries;
    try { entries = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries.map((x) => x.name).sort(comparePaths)) {
      const p = path.join(d, e);
      out.push(p);
      if (isDir(p)) walk(p);
    }
  };
  walk(dir);
  return out.sort(comparePaths);
}

/**
 * Hold `fn`'s stderr, and emit it only if `fn` returns.
 *
 * The reproduction of `except SystemExit` for a port that writes its refusal at the raise
 * site. See `renderedProblems`, its only caller — a general helper would invite a second
 * caller that wanted "silence the noise", which is a different thing from "this message
 * belonged to an exception nobody let escape".
 */
function withDiscardableStderr(fn) {
  const real = process.stderr.write.bind(process.stderr);
  const held = [];
  process.stderr.write = (chunk) => { held.push(chunk); return true; };
  try {
    const value = fn();
    process.stderr.write = real;
    for (const chunk of held) real(chunk);
    return value;
  } finally {
    process.stderr.write = real;
  }
}

/** `Path.stem` — the basename with its last suffix removed. */
const stemOf = (p) => path.basename(p, path.extname(p));

/** `sorted(set)` over strings, the ordering every problem list is emitted in. */
const sortedUnique = (xs) => [...new Set(xs)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
/** `sorted(probs)` — SORTED, not deduped, which is what `_ran` fills a group with. */
const sortedProblems = (xs) => [...xs].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

/**
 * `k in d` for a Python dict — OWN keys only.
 *
 * Every membership test in this file reads a key that came out of a JSON document or a source
 * filename, and a bare `k in obj` would answer true for `constructor`, `toString` and the rest
 * of `Object.prototype`. A theme defining a `toString` voice token, or a skill file named
 * `valueOf.md`, would then be reported as missing by the reference and not by this port — a
 * divergence no cell can reach and no reviewer would look for.
 */
const has = (obj, k) => Object.prototype.hasOwnProperty.call(obj, k);

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
    // `(md.parent / raw).resolve()` — `pyResolve`, not `path.resolve`, because Python's
    // canonicalises the symlinks in the part that exists and this comparison is against an
    // `out` that went through the same call.
    const target = pyResolve(path.join(path.dirname(md), raw));
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
  const outAbs = pyResolve(out);
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
        problems.push(`[colors] '${stemOf(p)}' role '${role}' is not #rrggbb hex: ${pyRepr(val)}`);
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

/** `_harness_build._src_stems` — spec stems under `src/<folder>`, minus `_`-scaffolds. */
function srcStems(folder) {
  const d = path.join(SRC, folder);
  if (!isDir(d)) return new Set();
  return new Set(globSorted(d, (n) => n.endsWith('.md') && !n.startsWith('_')).map(stemOf));
}

/**
 * `_harness_build._registry_keys` — every entity the registry must describe.
 *
 * The flat agent and skill specs plus the vendored skill FOLDERS, which have no flat spec and
 * are still shipped capabilities. Keyed `<folder>/<stem>`, the shape doctor already prints.
 */
function registryKeys() {
  const keys = new Set();
  for (const s of srcStems('agents')) keys.add(`agents/${s}`);
  for (const s of srcStems('skills')) keys.add(`skills/${s}`);
  for (const d of VENDORED_SKILL_DIRS) keys.add(`skills/${d}`);
  return keys;
}

const SEMVER_RE = /^\d+\.\d+\.\d+$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// `ENTITY_STATUSES`, `LAW_CLASSES`, `LAW_CLASS` and `SKILL_CLASS` moved to
// `js/inventory.mjs` in P6c — see the import above. They crossed HERE in P5g because
// doctor's authoring gates are what validate them, and they belong where Python keeps
// them (`_harness_tui`) now that the catalog reads them too. The gates below are
// unchanged, which is what licensed the move: a copy would have stopped being the
// value under test the first time one of them was edited.

/**
 * `_harness_build._registry_problems` — `registry.json` describes exactly what `src/`
 * provides, with well-formed fields.
 *
 * Two-way, like every anti-drift gate here: a new spec with no row and a row whose spec is
 * gone are both errors. Without the second half a shipped skill would show no lifecycle
 * status in the TUI and web catalogs while doctor stayed green. `last_verified` may be empty
 * — nothing writes it yet — but when set it must be a date.
 */
export function registryProblems() {
  let doc;
  const file = path.join(ROOT, 'registry.json');
  let raw;
  try { raw = readText(file); } catch (e) {
    return [`[authoring] registry.json unreadable: ${e.message}`];
  }
  try { doc = JSON.parse(raw); } catch (e) {
    return [`[authoring] registry.json is not valid JSON: ${e.message}`];
  }
  const entities = doc && typeof doc === 'object' && !Array.isArray(doc) ? doc.entities : null;
  if (entities === null || typeof entities !== 'object' || Array.isArray(entities)) {
    return ["[authoring] registry.json has no 'entities' object"];
  }
  const expected = registryKeys();
  const present = new Set(Object.keys(entities));
  const problems = [...expected].filter((k) => !present.has(k)).sort()
    .map((key) => `[authoring] ${key} has no row in registry.json`);
  problems.push(...[...present].filter((k) => !expected.has(k)).sort()
    .map((key) => `[authoring] registry.json lists '${key}' but no such entity exists`));
  for (const key of [...expected].filter((k) => present.has(k)).sort()) {
    const row = entities[key];
    if (row === null || typeof row !== 'object' || Array.isArray(row)) {
      problems.push(`[authoring] registry.json['${key}'] is not an object`);
      continue;
    }
    // `row.get(...)` is None for an absent key, and `!r` renders that as `None`; a bare JS
    // lookup is `undefined`, which `pyRepr` would not recognise as one.
    if (!ENTITY_STATUSES.includes(row.status)) {
      problems.push(`[authoring] registry.json['${key}'].status ${pyRepr(row.status ?? null)} `
        + `is not one of ${pyRepr(ENTITY_STATUSES)}`);
    }
    if (!SEMVER_RE.test(pyStr(row.version ?? ''))) {
      problems.push(`[authoring] registry.json['${key}'].version `
        + `${pyRepr(row.version ?? null)} is not a semver (N.N.N)`);
    }
    if (!pyStr(row.owner ?? '').trim()) {
      problems.push(`[authoring] registry.json['${key}'] has no owner`);
    }
    for (const field of ['added', 'last_verified']) {
      const value = pyStr(row[field] ?? '');
      if (value && !ISO_DATE_RE.test(value)) {
        problems.push(`[authoring] registry.json['${key}'].${field} ${pyRepr(value)} is `
          + 'not an ISO date (YYYY-MM-DD) or empty');
      }
    }
  }
  return problems;
}

/**
 * `_harness_build._SECRET_PATTERNS` — credential shapes, by the prefix each issuer stamps,
 * plus the generic assignment. Deliberately narrow: a gate that cries wolf gets disabled.
 *
 * `(?i)` becomes the `i` flag on the last one only, which is where the Python puts it.
 */
const SECRET_PATTERNS = [
  ['Anthropic API key', /sk-ant-[A-Za-z0-9_-]{20,}/],
  ['OpenAI-style API key', /\bsk-[A-Za-z0-9]{32,}/],
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{36}\b/],
  ['AWS access key id', /\bAKIA[0-9A-Z]{16}\b/],
  ['Slack token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ['private key block', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['assigned credential',
    /\b(password|passwd|secret|api[_-]?key|access[_-]?token)\s*[:=]\s*["'][^"'\s]{8,}["']/i],
];

/**
 * `_harness_build._secret_problems` — no credential may ship.
 *
 * Sweeps the four trees `sourceFingerprint()` hashes, which is exactly the material that ends
 * up inside a user's bundle. Reports file:line and the KIND only — echoing the matched text
 * would republish the secret into every CI log.
 */
export function secretProblems() {
  const problems = [];
  for (const root of [SRC, THEMES, PLUGIN_SRC, WORKFLOW_SRC]) {
    if (!isDir(root)) continue;
    for (const p of rglob(root)) {
      if (!isFile(p) || p.split(path.sep).includes('__pycache__')) continue;
      // `except (OSError, UnicodeDecodeError): continue` — binary or unreadable, nothing to
      // scan. `readText` would substitute U+FFFD where Python RAISES, so the strict decode is
      // the check rather than a catch, and the newline folding `Path.read_text` does has to
      // be applied by hand afterwards for the LINE NUMBERS to agree.
      let raw;
      try { raw = readFileSync(p); } catch { continue; }
      let s;
      try { s = new TextDecoder('utf-8', { fatal: true }).decode(raw); } catch { continue; }
      s = s.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
      // `path.relative` returns a `..`-prefixed path where `relative_to` RAISES; the fallback
      // is the Python's, for a tree outside the repo (a test tmpdir).
      const r = path.relative(ROOT, p);
      const rel = (r.startsWith('..') || path.isAbsolute(r) ? p : r)
        .split(path.sep).join('/');
      // `str.splitlines()`, not `split('\n')`: it also breaks on VT, FF, NEL and the two
      // Unicode separators, and the line NUMBER is printed.
      pySplitLines(s).forEach((line, i) => {
        for (const [label, pattern] of SECRET_PATTERNS) {
          if (pattern.test(line)) {
            problems.push(`[authoring] possible ${label} in ${rel}:${i + 1} — a `
              + 'credential must never be committed');
          }
        }
      });
    }
  }
  return problems;
}

/**
 * `_harness_build._shim_problems` — the hook shim exists and points at something real.
 *
 * This gate exists because the shim DISARMED an accidental safety net. When the emitted hook
 * command still carried the checkout path, moving the checkout made that command
 * non-canonical and the next emit's prune-and-rewire repaired every install by itself. Now
 * the config is invariant under a move and the stale path lives in the shim body, which no
 * other gate reads (the build scan only walks `*.md`). Without this a moved checkout leaves
 * every gate silently dead: the hooks still fire, the shim still runs, and the interpreter
 * reports "no such file" into a channel nobody reads.
 *
 * An ABSENT shim is not a problem: a source checkout that has never emitted has no reason to
 * own one.
 */
export function shimProblems() {
  const p = hookShimPath();
  if (!isFile(p)) return [];
  let body;
  try { body = readText(p); } catch (e) {
    return [`[shim] ${p} exists but cannot be read (${e.message}) — hooks may be dead`];
  }
  // The body is machine-generated; both forms quote the two paths and nothing else.
  const quoted = [...body.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  return quoted.filter((q) => !existsSync(q)).map(
    (m) => `[shim] ${p} pointed at ${m}, which does not exist — every hook in every `
      + "install was dead (the checkout most likely moved). This run's own "
      + 'emit has refreshed it; no further action needed.',
  );
}

const HEX40_RE = /^[0-9a-f]{40}$/;
/** Refs that move under the pin — re-copying months later changes the shipped skill. */
const MOVING_REFS = new Set(['main', 'master', 'develop', 'dev', 'head', 'latest', 'trunk']);

/**
 * `_harness_build._vendor_pin_problems` — every vendored skill folder records where it came
 * from, under which license, and at WHICH immutable commit.
 *
 * First-party folders that merely ride the vendored mechanism for their multi-file layout
 * declare that instead (`**Upstream:** this …`) and are exempt from the pin: there is no
 * upstream to drift against.
 */
export function vendorPinProblems() {
  const problems = [];
  for (const name of VENDORED_SKILL_DIRS) {
    const folder = path.join(SRC, 'skills', name);
    if (!isDir(folder)) {
      problems.push(`[authoring] VENDORED_SKILL_DIRS lists '${name}' but `
        + `src/skills/${name}/ does not exist`);
      continue;
    }
    let text;
    try { text = readText(path.join(folder, 'VENDOR.md')); } catch {
      problems.push(`[authoring] skills/${name}/ has no VENDOR.md — its upstream, `
        + 'pinned commit and license are unrecorded');
      continue;
    }
    if (!/\*\*License:\*\*/.test(text)) {
      problems.push(`[authoring] skills/${name}/VENDOR.md records no '**License:**'`);
    }
    const upstream = /\*\*Upstream:\*\*\s*(\S+)/.exec(text);
    if (!upstream) {
      problems.push(`[authoring] skills/${name}/VENDOR.md declares no '**Upstream:**'`);
      continue;
    }
    if (upstream[1].toLowerCase().startsWith('this')) continue;  // first-party
    const pin = /\*\*Commit:\*\*\s*(\S+)/.exec(text);
    if (!pin) {
      problems.push(`[authoring] skills/${name}/VENDOR.md has no '**Commit:**' pin`);
    } else if (MOVING_REFS.has(pin[1].toLowerCase())) {
      problems.push(`[authoring] skills/${name}/VENDOR.md pins '${pin[1]}', a `
        + 'moving branch — record the commit sha instead');
    } else if (!HEX40_RE.test(pin[1].toLowerCase())) {
      problems.push(`[authoring] skills/${name}/VENDOR.md pin '${pin[1]}' is not `
        + 'a 40-character commit sha');
    }
  }
  return problems;
}

const ROMAN_VALUES = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };

/**
 * `_harness_build._roman_to_int`. Law headings number in Roman and the web ledger keys its
 * per-rule copy by the Arabic equivalent, so the gate has to bridge the two. 0 on an
 * unparseable numeral, which surfaces as a gate problem rather than a crash.
 */
export function romanToInt(num) {
  let total = 0;
  let prev = 0;
  for (const ch of [...num.toUpperCase()].reverse()) {
    const v = ROMAN_VALUES[ch];
    if (v === undefined) return 0;
    total += v < prev ? -v : v;
    prev = Math.max(prev, v);
  }
  return total;
}

/**
 * `_harness_build._LAW_META_ROW` — `<arabic>: ['<class>', '<principle>'],` in the web page.
 *
 * Either quote style, because a principle carrying an apostrophe is double-quoted. Every
 * `\s*` spans newlines and the trailing comma before `]` is optional, so a row a prettier has
 * reflowed across several lines still matches — a gate that only understood the one-line form
 * silently lost it and left the law's Principle unguarded.
 *
 * `(?m)` is the `m` flag; JS has no inline form. The `.` inside the captures must NOT match a
 * newline (Python has no `re.S` here), which is JS's default.
 */
const LAW_META_ROW = /^[^\S\n]*(\d+):\s*\[\s*(['"])(.*?)\2\s*,\s*(['"])(.*?)\4\s*,?\s*\]\s*,?[^\S\n]*$/gm;

/**
 * `_harness_build._law_meta_problems` — the web Laws ledger's per-rule copy stays complete.
 *
 * `LAW_META` holds each law's one-line Principle, copy that exists nowhere else in the tree,
 * and a law with no row falls back to `['craft', '']`: the rule renders with a blank
 * description and the wrong class chip, while everything upstream is fine. That is exactly
 * how two laws shipped description-less.
 */
export function lawMetaProblems(lawNums, lawClass, lawClasses) {
  const page = path.join(ROOT, 'web', 'src', 'pages', 'Laws.jsx');
  let text;
  try { text = readText(page); } catch (e) {
    return [`[authoring] web/src/pages/Laws.jsx unreadable: ${e.message}`];
  }
  const block = /^const LAW_META = \{$([\s\S]*?)^\}$/m.exec(text);
  if (!block) {
    return ['[authoring] LAW_META literal not found in web/src/pages/Laws.jsx — the web '
      + 'Laws ledger\'s Principle column would have no gate'];
  }
  const meta = new Map();
  for (const m of block[1].matchAll(LAW_META_ROW)) {
    meta.set(Number(m[1]), [m[3], m[5]]);
  }
  const problems = [];
  const seen = new Set();
  for (const roman of lawNums) {
    const n = romanToInt(roman);
    seen.add(n);
    if (!meta.has(n)) {
      problems.push(`[authoring] laws/universal.md rule ${roman} (${n}) has no row in `
        + 'LAW_META (web/src/pages/Laws.jsx) — the web Laws ledger would '
        + 'render it with a blank Principle');
      continue;
    }
    const [klass, principle] = meta.get(n);
    if (!principle.trim()) {
      problems.push(`[authoring] LAW_META[${n}] has an empty principle line — rule `
        + `${roman} would render with a blank description`);
    }
    if (!lawClasses.includes(klass)) {
      problems.push(`[authoring] LAW_META[${n}] class '${klass}' is not a known class `
        + `${pyRepr(lawClasses)}`);
    } else if (lawClass[roman] && klass !== lawClass[roman]) {
      problems.push(`[authoring] LAW_META[${n}] classes rule ${roman} as '${klass}' but `
        + `LAW_CLASS says '${lawClass[roman]}'`);
    }
  }
  for (const n of [...meta.keys()].filter((k) => !seen.has(k)).sort((a, b) => a - b)) {
    problems.push(`[authoring] LAW_META lists rule ${n} but laws/universal.md has no such rule`);
  }
  return problems;
}

/**
 * `_harness_build._prose_mirror_problems` — the human-readable count mirrors, the ones the
 * badge regex never sees.
 *
 * The README "What you get" table and the web onboarding copy each restate the law / agent /
 * skill counts in prose, and the README enumerates the skills by name. Nothing renders these,
 * so they drift silently — they already had. Pure over its inputs, so the corpus can feed it
 * crafted drift without touching the tree.
 */
export function proseMirrorProblems(readme, web, counts, skillStems, shipped = '') {
  const problems = [];
  const { laws, agents, skills } = counts;

  for (const m of readme.matchAll(/(\d+) universal laws/g)) {
    if (Number(m[1]) !== laws) {
      problems.push(`[authoring] README prose says '${m[1]} universal laws' but src has ${laws}`);
    }
  }
  for (const [label, want] of [['Agents', agents], ['Skills', skills]]) {
    const m = new RegExp(`${label}\\*\\*\\s*\\((\\d+)\\)`).exec(readme);
    if (m && Number(m[1]) !== want) {
      problems.push(`[authoring] README '${label} (${m[1]})' but src has ${want}`);
    }
  }
  // The README Skills row must enumerate EXACTLY the source skills — a dropped name is
  // invisible to the (N) count alone, which is the off-by-one this gate forbids.
  const row = readme.split('\n').find((ln) => ln.includes('🛠') && ln.includes('Skills')) ?? '';
  if (row.includes('workflows:')) {
    const listed = new Set(row.split('workflows:').slice(1).join('workflows:').split('·')
      .map((seg) => seg.replace(/[^a-z0-9-]/g, '')));
    listed.delete('');
    for (const missing of [...skillStems].filter((s) => !listed.has(s)).sort()) {
      problems.push(`[authoring] README skills list omits '${missing}'`);
    }
    for (const orphan of [...listed].filter((s) => !skillStems.has(s)).sort()) {
      problems.push(`[authoring] README skills list names '${orphan}' but no `
        + `skills/${orphan}.md exists`);
    }
  }

  for (const m of web.matchAll(/(\d+) universal (?:laws|Rules)/g)) {
    if (Number(m[1]) !== laws) {
      problems.push(`[authoring] _web_core prose says '${m[1]} universal laws/Rules' but `
        + `src has ${laws}`);
    }
  }
  for (const m of web.matchAll(/(\d+) capability specialists/g)) {
    if (Number(m[1]) !== agents) {
      problems.push(`[authoring] _web_core prose says '${m[1]} capability specialists' but `
        + `src has ${agents}`);
    }
  }
  // N is a curated-subset size, not the total, so it is gated against the wikilinks it
  // introduces rather than against the skill count. `[\s\S]` is Python's `re.S` dot.
  const m = /(\d+) repeatable workflows the agent can invoke by name([\s\S]*?)playbook under/
    .exec(web);
  if (m) {
    const listedN = (m[2].match(/\[\[[^\]]+\]\]/g) ?? []).length;
    if (Number(m[1]) !== listedN) {
      problems.push(`[authoring] _web_core says '${m[1]} repeatable workflows' `
        + `but its wikilink list has ${listedN}`);
    }
  }

  const s = /(\d+) laws, (\d+) agents, (\d+) skills/.exec(shipped);
  if (s) {
    for (const [got, want, label] of [[s[1], laws, 'laws'], [s[2], agents, 'agents'],
      [s[3], skills, 'skills']]) {
      if (Number(got) !== want) {
        problems.push(`[authoring] SHIPPED.md says '${got} ${label}' but src has ${want}`);
      }
    }
  }
  return problems;
}

/** `_build_render._TMPL_SPEC_RE`, as the count gate spells it. */
const TMPL_SPEC_RE = /\{\{DIR_(AGENTS|SKILLS)\}\}\/([A-Za-z0-9_-]+)\.md/g;
const LAW_HEADING_RE = /^### \{\{LAW\}\} ([IVXLCDM]+)\b/gm;

/**
 * `_harness_build._count_table_problems` — the hand-authored AGENT.md tables and the README
 * badges, against `src/`.
 *
 * The tables must list EXACTLY the spec files (no dead row, no orphaned spec) and each
 * `agents`/`skills`/`laws`/`themes` badge must equal the real count. This is the
 * authoring-time guarantee that lets tables, badges and prose stay hand-written without
 * silently drifting from the source tree.
 */
export function countTableProblems() {
  const problems = [];
  let ttext;
  try { ttext = readText(path.join(SRC, 'AGENT.md.tmpl')); } catch (e) {
    return [`[authoring] AGENT.md.tmpl unreadable: ${e.message}`];
  }

  const linked = { agents: new Set(), skills: new Set() };
  for (const m of ttext.matchAll(TMPL_SPEC_RE)) {
    if (m[2] !== '_template') linked[m[1] === 'AGENTS' ? 'agents' : 'skills'].add(m[2]);
  }
  for (const folder of ['agents', 'skills']) {
    const files = srcStems(folder);
    for (const missing of [...linked[folder]].filter((x) => !files.has(x)).sort()) {
      problems.push(`[authoring] AGENT.md links ${folder}/${missing}.md but no such spec exists`);
    }
    for (const orphan of [...files].filter((x) => !linked[folder].has(x)).sort()) {
      problems.push(`[authoring] ${folder}/${orphan}.md exists but the AGENT.md table omits it`);
    }
  }

  const skillFiles = srcStems('skills');
  for (const missing of [...skillFiles].filter((s) => !has(SKILL_CLASS, s)).sort()) {
    problems.push(`[authoring] skills/${missing}.md has no category in SKILL_CLASS `
      + '(_harness_tui.py)');
  }
  for (const stale of Object.keys(SKILL_CLASS).filter((s) => !skillFiles.has(s)).sort()) {
    problems.push(`[authoring] SKILL_CLASS lists '${stale}' but no skills/${stale}.md exists`);
  }

  const lawsMd = path.join(SRC, 'laws', 'universal.md');
  const lawNums = isFile(lawsMd)
    ? [...readText(lawsMd).matchAll(LAW_HEADING_RE)].map((m) => m[1]) : [];
  for (const num of lawNums) {
    if (!has(LAW_CLASS, num)) {
      problems.push(`[authoring] laws/universal.md rule ${num} has no class in LAW_CLASS `
        + '(_harness_tui.py)');
    }
  }
  // `sorted(LAW_CLASS.items())` — by the Roman numeral as a STRING, which is what Python
  // sorts here; the messages are re-sorted by `doctorCollect` anyway, so only the set travels.
  for (const num of Object.keys(LAW_CLASS).sort()) {
    if (!LAW_CLASSES.includes(LAW_CLASS[num])) {
      problems.push(`[authoring] LAW_CLASS['${num}'] = '${LAW_CLASS[num]}' is not a known `
        + `class ${pyRepr(LAW_CLASSES)}`);
    }
  }
  problems.push(...lawMetaProblems(lawNums, LAW_CLASS, LAW_CLASSES));

  const counts = {
    agents: srcStems('agents').size,
    skills: srcStems('skills').size,
    laws: lawNums.length,
    themes: themeFiles().length,
  };
  let readme;
  try { readme = readText(path.join(ROOT, 'README.md')); } catch { return problems; }
  for (const [key, n] of Object.entries(counts)) {
    const m = new RegExp(`badge/${key}-(\\d+)`).exec(readme);
    if (m && Number(m[1]) !== n) {
      problems.push(`[authoring] README ${key} badge says ${m[1]} but src has ${n}`);
    }
  }

  let web;
  try { web = readText(path.join(ROOT, 'rituals', '_web_core.py')); } catch { web = ''; }
  let shipped;
  try { shipped = readText(path.join(ROOT, 'SHIPPED.md')); } catch { shipped = ''; }
  problems.push(...proseMirrorProblems(readme, web, counts, skillFiles, shipped));
  return problems;
}

/** `_harness_core.LEARN_PROMPT_HEAD`'s extraction regex — one owner, two readers. */
const LEARN_PROMPT_RE = /const LEARN_PROMPT_HEAD = `([\s\S]*?)`/;

/**
 * `_harness_core._load_learn_prompt_head` — the distil instructions, read out of the plugin.
 *
 * The single source of truth is the OpenCode plugin, the artifact that ships to the primary
 * runtime, so the CLI extracts it at load time rather than carrying a copy. Reproduced here
 * rather than imported from `js/hooks.mjs`, which this entry may not reach: `learn` spawns the
 * model CLI, and the allow-list below names ONE call site.
 *
 * The fallback matters as much as the extraction. It is what makes the drift arm of
 * `_authoring_problems` unreachable — both the loaded copy and the checked literal come from
 * one file through one regex, so a reference can never disagree with itself. A port that
 * hardcoded the prompt WOULD disagree, which is what
 * `doctor/the-loaded-copy-follows-the-plugin-rather-than-a-constant` exists to catch.
 */
function loadLearnPromptHead() {
  try {
    const m = LEARN_PROMPT_RE.exec(readText(path.join(PLUGIN_SRC, 'geneseed-learn.js')));
    if (m) return m[1];
  } catch { /* OSError — fall through */ }
  return 'Distil at most one durable, reusable memory from the notes below. '
    + 'When in doubt, output exactly: NOTHING.';
}

/**
 * `_harness_build._authoring_problems` — author-time gates on the source specs and plugins.
 *
 * Every agent/skill spec must carry a one-line `>` purpose blockquote as the FIRST content
 * block after its title, or its `description:` on every host either renders empty or silently
 * picks up the WRONG line; the learn-prompt literal must stay extractable; and, if node is on
 * PATH, the plugins must pass `node --check`. Then three source-wide gates: the lifecycle
 * registry describes exactly what `src/` provides, no credential ships, and every vendored
 * folder carries an immutable upstream pin.
 */
export function authoringProblems() {
  const problems = [];
  for (const folder of ['agents', 'skills']) {
    const d = path.join(SRC, folder);
    if (!isDir(d)) continue;
    for (const spec of globSorted(d, (n) => n.endsWith('.md') && !n.startsWith('_'))) {
      let text;
      try { text = readText(spec); } catch (e) {
        problems.push(`[authoring] ${folder}/${path.basename(spec)} unreadable: ${e.message}`);
        continue;
      }
      if (!firstBlockquote(text)) {
        problems.push(`[authoring] ${folder}/${path.basename(spec)} has no '>' purpose line `
          + '(its OpenCode description would render empty)');
        continue;
      }
      const reason = descBlockProblem(text);
      if (reason) {
        problems.push(`[authoring] ${folder}/${path.basename(spec)}: ${reason} — `
          + 'desc_of() would silently extract the wrong description');
      }
    }
  }
  const plugin = path.join(PLUGIN_SRC, 'geneseed-learn.js');
  let m = null;
  try { m = LEARN_PROMPT_RE.exec(readText(plugin)); } catch { m = null; }
  if (!m) {
    problems.push('[authoring] LEARN_PROMPT_HEAD literal not found in '
      + 'geneseed-learn.js — harness.py would fall back (single source broken)');
  } else if (m[1] !== loadLearnPromptHead()) {
    problems.push('[authoring] LEARN_PROMPT_HEAD drifted between geneseed-learn.js '
      + "and harness.py's loaded copy");
  }
  const node = pyWhich('node');
  if (node) {
    for (const js of globSorted(PLUGIN_SRC, (n) => n.endsWith('.js'))) {
      // THE ONE SPAWN. `node --check` and nothing else — see the module header, and
      // `test_the_cli_spawns_only_a_node_syntax_check`, which names this argv.
      const r = spawnSync(node, ['--check', js], { encoding: 'utf-8' });
      if (r.status !== 0) {
        // `(stderr.strip().splitlines() or ["syntax error"])[-1]` — node's LAST line, which
        // is its version banner rather than the SyntaxError. Faithful, and surprising enough
        // that the cell asserts the prefix and never the version.
        const lines = (r.stderr ?? '').trim().split('\n').filter((x) => x !== '');
        const tail = lines.length ? lines[lines.length - 1] : 'syntax error';
        problems.push(`[authoring] node --check failed for ${path.basename(js)}: ${tail}`);
      }
    }
  }
  problems.push(...registryProblems());
  problems.push(...secretProblems());
  problems.push(...vendorPinProblems());
  problems.push(...countTableProblems());
  return problems;
}

/**
 * `_harness_build._themes_to_check` — which themes doctor validates.
 *
 * An explicit `--theme` wins. Otherwise, unless `--all` forces the maintainer sweep, scope to
 * the theme THIS host installed so a one-theme user is not buried under the same problem
 * echoed across all fourteen. Falls back to the full sweep when nothing is installed (a fresh
 * clone) or the detected theme is unknown, so a maintainer in a clean checkout still gets
 * full coverage. Pure, and gated as such: `--all` is a 14-theme sweep no cell can afford.
 */
export function themesToCheck(theme, allThemes, detected, available) {
  if (theme) return [theme];
  if (!allThemes && detected && available.includes(detected)) return [detected];
  return [...available].sort();
}

/** `tempfile.TemporaryDirectory()` — created, handed to `fn`, removed whatever happens. */
function withTempDir(fn) {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'geneseed-doctor-'));
  try { return fn(tmp); } finally { rmSync(tmp, { recursive: true, force: true }); }
}

/**
 * `contextlib.redirect_stdout(io.StringIO())` — swallow an emit's log, and ONLY stdout.
 *
 * The Python redirects stdout and leaves stderr alone, so a WARN from the emit still reaches
 * the user. Reproducing that exactly is the point: swallowing both would hide
 * `warnBobGlobalOverProject` and swallowing neither would put ~200 lines of emit summary into
 * doctor's output. `withPyNewlines` inside `emitGlobalInto` wraps whatever `write` is
 * installed at call time, so it translates into this buffer and the bytes never leave.
 */
function swallowStdout(fn) {
  const real = process.stdout.write.bind(process.stdout);
  process.stdout.write = () => true;
  try { return fn(); } finally { process.stdout.write = real; }
}

/**
 * `_harness_build._global_emit_problems` — validate the opencode-global emit, in BOTH
 * footprints.
 *
 * The RECOMMENDED install, and otherwise a doctor blind spot: the files build and ./Harness
 * were checked and the global layout never was. The two footprints produce genuinely
 * different AGENT.md bodies — lean swaps the inlined laws for a digest plus a pointer and
 * ships a standalone laws file the full emit does not write — so checking one leaves the
 * other's links and tokens unvalidated, and lean being the default made that the shape most
 * installs actually run.
 */
export function globalEmitProblems(themeName) {
  const problems = [];
  for (const footprint of ['lean', 'full']) {
    withTempDir((tmp) => {
      const cfgDir = path.join(tmp, 'cfg');
      try {
        swallowStdout(() => emitGlobalInto('opencode', {
          theme: themeName, out: path.join(tmp, 'bundle'), cfgDir, footprint,
        }));
      } catch (e) {
        if (e && e.exitCode !== undefined) {
          problems.push(`[${themeName} global/${footprint}] build failed`);
          return;
        }
        throw e;
      }
      problems.push(...checkBuild(`${themeName} global/${footprint}`, cfgDir));
    });
  }
  return problems;
}

/**
 * `_harness_build._claude_bob_emit_problems` — validate the claude/bob/copilot PER-REPO
 * emits, which were never checked before.
 *
 * That is exactly why the CLAUDE.md/AGENTS.md skill-table dead links shipped unnoticed: the
 * emits that render straight into a repo were outside doctor's sweep. Scanned with
 * `validateIsVendored` rather than `isVendoredPath`, because the native per-repo layer nests
 * skills one level deeper than a bundle does.
 */
export function claudeBobEmitProblems(themeName) {
  const problems = [];
  for (const label of ['claude', 'bob', 'copilot']) {
    withTempDir((tmp) => {
      const root = path.join(tmp, 'root');
      try {
        swallowStdout(() => emitProjectInto(label, {
          theme: themeName, out: path.join(root, 'bundle'), root,
        }));
      } catch (e) {
        if (e && e.exitCode !== undefined) {
          problems.push(`[${themeName} ${label}] build failed`);
          return;
        }
        throw e;
      }
      problems.push(...checkBuild(`${themeName} ${label}`, root, validateIsVendored));
    });
  }
  return problems;
}

/**
 * `_harness_build._doctor_collect` — run every check; return `[themes, problems]`.
 *
 * TWO PARAMETERS OF THE PYTHON ARE NOT HERE, and both are absences on purpose. `on_progress`
 * is the TUI's — it drags ~140 lines of curses drawing behind it and no caller this binary
 * has can supply one. `groups` is the WEB's, the structured `{check, label, problems}` view
 * the Doctor page renders, and `_web_actions.py` / `_web_core.py` are its only callers; both
 * stay Python until P6. Four lines of accumulator with no caller and no cell is unreachable
 * code that is not part of an asserted partition, which is this port's own criterion for
 * deleting rather than keeping. P6 adds it with the caller that needs it.
 *
 * THE PER-THEME BUILD IS THE DRIVER, IN-PROCESS. The Python shells to `build.py` and reads a
 * return code; here that is `driverMain`, the route P5e established and the only one the
 * `child_process` allow-list leaves. `cwd=ROOT` does not travel in-process and does not have
 * to: `--out` is an absolute path, which is the one input `resolveOut` would have read the
 * working directory for.
 */
export function doctorCollect({
  theme = null, allThemes = false, bundle = null, noBundle = false, groups = null,
} = {}) {
  const available = themeFiles().map(stemOf);
  if (!available.length) return [[], ['[doctor] no themes found']];

  // `_ran` — the label is the one place each check is NAMED, and since P6b a caller can
  // pass an array to collect them. `/api/doctor` renders one card per entry, which is the
  // only reason the structured view exists; `cmd_doctor` passes nothing and gets the flat
  // list, so the return contract is unchanged either way. `on_progress` is still P7's.
  const ran = (check, label, probs) => {
    if (groups !== null) groups.push({ check, label, problems: sortedProblems(probs) });
    return probs;
  };

  // Only probe the deployed install when we actually need it (no theme / not --all).
  const detected = (theme || allThemes) ? null : (installedDefaults().theme ?? null);
  const themes = themesToCheck(theme, allThemes, detected, available);
  // Sampled HERE, before the emit loop below — every emit rewrites the hook shim, so a check
  // placed after them could only ever observe the freshly repaired file and would be dead
  // code that always reports clean. Reported in its usual slot further down.
  const shimProbs = shimProblems();
  let problems = [];
  withTempDir((tmp) => {
    for (const themeName of themes) {
      const out = path.join(tmp, themeName);
      // capture_output=True: BOTH streams, unlike the emits below, which redirect stdout
      // only. A failing build's stderr is not doctor's output either — the return code is.
      const rc = captureBoth(() => driverMain(['--theme', themeName, '--out', out]));
      if (rc !== 0) {
        problems = problems.concat(ran('build', `Build scan (${themeName})`,
          [`[${themeName}] build failed`]));
        continue;
      }
      problems = problems.concat(ran('build', `Build scan (${themeName})`,
        checkBuild(themeName, out)));
      problems = problems.concat(ran('global', `Global install (${themeName})`,
        globalEmitProblems(themeName)));
      problems = problems.concat(ran('claude_bob',
        `Claude/Bob/Copilot per-repo emit (${themeName})`, claudeBobEmitProblems(themeName)));
    }
  });
  problems = problems.concat(ran('parity', 'Theme parity', themeParityProblems()));
  problems = problems.concat(ran('colors', 'Colour themes', colorThemeProblems()));
  problems = problems.concat(ran('authoring', 'Authoring gates', authoringProblems()));
  problems = problems.concat(ran('shim', 'Hook shim', shimProbs));
  if (!noBundle) {
    // `Path(bundle).expanduser().resolve()`, which `pyResolve` already IS — the default is
    // deliberately NOT resolved, because the Python's `ROOT / "Harness"` is not either and
    // the resolved spelling is what the messages print.
    const b = bundle ? pyResolve(bundle) : path.join(ROOT, 'Harness');
    problems = problems.concat(ran('bundle', 'Committed bundle drift', renderedProblems(b)));
  }
  return [themes, sortedUnique(problems)];
}

/** `run(..., capture_output=True)` — both streams into the void, the return code out. */
function captureBoth(fn) {
  const out = process.stdout.write.bind(process.stdout);
  const err = process.stderr.write.bind(process.stderr);
  process.stdout.write = () => true;
  process.stderr.write = () => true;
  try { return fn(); } finally { process.stdout.write = out; process.stderr.write = err; }
}

/**
 * `_harness_build.cmd_doctor` — the CLI face.
 *
 * With `--theme`, one theme. With none it scopes to the INSTALLED theme, so a one-theme
 * install is not buried under the same issue repeated across every theme; `--all` is the full
 * maintainer sweep. The cross-theme parity check runs in every mode.
 */
export function cmdDoctor(args) {
  const [themes, problems] = doctorCollect({
    theme: args.theme, allThemes: Boolean(args.all), bundle: args.bundle,
    noBundle: Boolean(args.noBundle),
  });
  if (!themes.length) {
    pyPrint(`${problems.length ? problems[0] : '[doctor] no themes found'}\n`);
    return 1;
  }
  const scoped = !args.theme && !args.all && themes.length === 1;
  const note = scoped
    ? `  (scoped to installed theme '${themes[0]}'; run with --all to sweep every theme)` : '';
  if (problems.length) {
    pyPrint(`[doctor] ${problems.length} problem(s) across ${themes.length} theme(s):\n`);
    for (const p of problems) pyPrint(`  - ${p}\n`);
    if (problems.some((p) => p.includes('dead link'))) {
      pyPrint('  tip: dead links to skills mean your source is incomplete — run '
        + '`./geneseed update` (or re-sync src/), then re-check.\n');
    }
    if (problems.some((p) => p.startsWith('[themes]') && p.includes('missing key'))) {
      pyPrint('  tip: a theme is missing a key another theme defines — run '
        + '`python build.py --sync-themes` to fill it from _TEMPLATE.json, '
        + 'then restyle the added key(s) and re-check.\n');
    }
    if (note) pyPrint(`${note}\n`);
    return 1;
  }
  pyPrint('[doctor] ok — ' + `${themes.length} theme(s) clean: no unresolved tokens, no dead `
    + 'links, nothing escapes the bundle; themes in parity; specs carry purpose '
    + 'lines; rendered bundle in sync\n');
  if (note) pyPrint(`${note}\n`);
  return 0;
}
