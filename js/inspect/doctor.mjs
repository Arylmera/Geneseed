/**
 * `_harness_build.cmd_doctor` — validate the build.
 *
 * Fifteen `*Problems` checks over one theme (or every theme) — and `[doctor] ok — …` when all
 * fifteen find nothing. That last sentence is why this module's gate looks the way it does, and
 * it is worth stating here rather than only in the spec: **delete any single check
 * and a clean run is byte-identical**, so a comparison of two runs cannot tell this
 * file from a stub that prints the OK line. `tests/unit/harness.test.mjs` and
 * `tests/unit/authoring_gates.test.mjs` therefore plant ONE FAULT PER CHECK, in a private copy
 * of the checkout — see `copyCheckout` in `tests/helpers/cli_golden.mjs` for why a verb that
 * reads `ROOT` needed a fixture kind that did not exist until the port.
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

import {
  CONFIG, PACK_ORDER, PLUGIN_SRC, ROOT, SRC, THEMES, WORKFLOW_SRC, knownRuleIds, makeCfg,
} from '../build/source.mjs';
import {
  buildInto, main as driverMain, emitGlobalInto, emitProjectInto,
} from '../../bin/build-driver.mjs';
import { stripCapabilityLinks } from '../build/emit.mjs';
import { hostCatalogsNatively, pyResolve } from '../hosts/hosts.mjs';
import { EMIT_HOST_SCOPE, footprintOfDir, installedDefaults, themeFiles } from '../hosts/installs.mjs';
import {
  ENTITY_STATUSES, LAW_CLASS, LAW_CLASSES, SKILL_CLASS,
} from './inventory.mjs';
import {
  VENDORED_SKILL_DIRS, descBlockProblem, firstBlockquote, isVendoredPath, validateIsVendored,
} from '../hosts/native.mjs';
import { PALETTE_ROLES, colorThemeFiles } from '../hosts/opencode.mjs';
import { STRUCTURE, renderAll } from '../build/render.mjs';
import { hookShimPath, shimDeadPaths } from '../hosts/settings.mjs';
import { pySplitLines } from '../lib/udiff.mjs';
import { NO_WINDOW } from '../lib/proc.mjs';
import { pyPrint, pyPrintErr, readText, withDiscardableStderr } from '../lib/fs.mjs';
import { parseJson, pyRepr, pyStr } from '../lib/json.mjs';
import { comparePaths, normcase, pyWhich } from '../lib/paths.mjs';
import { pyStripSpace } from '../lib/text.mjs';

// --------------------------------------------------------------------------------------
// _harness_core's scanning primitives
// --------------------------------------------------------------------------------------

/** `_harness_core.TOKEN_RE` / `LINK_RE` / `ABS_LINK_RE`. `g` where `findall` is used. */
// Must stay in step with `js/render.mjs`'s TOKEN_RE: a token the renderer substitutes but this
// scan cannot see is an unresolved-token gate that silently stops gating. Digits are legal after
// the first character for `DOC_<PACK>_<n>`; a leading digit is still not a token.
const TOKEN_RE = /\{\{[A-Z_][A-Z0-9_]*\}\}/g;
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

// `withDiscardableStderr` was defined here while `renderedProblems` was its only caller.
// `js/hooks.mjs` became the second and third when the hook started CATCHING `expanduser`'s
// refusal, so it moved beside `pyPrintErr` in `js/lib/fs.mjs` — the writes it intercepts —
// and its docblock carries the "not for silencing noise" warning with it.

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
  // The body is machine-generated and quotes the two baked paths — plus, on POSIX, the argv
  // placeholder `"$@"`, which is not a path. `shimDeadPaths` is the single owner of that rule;
  // `hookPrefix` is its other reader, and the two must not drift.
  return shimDeadPaths(body).map(
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

/** `LAW_META_ROW`'s twin for a STRING key — `'<pack>.<n>': ['<pack>', '<principle>'],`. */
const DOCTRINE_META_ROW =
  /^[^\S\n]*(['"])([a-z]+\.\d+)\1:\s*\[\s*(['"])(.*?)\3\s*,\s*(['"])(.*?)\5\s*,?\s*\]\s*,?[^\S\n]*$/gm;

/**
 * `lawMetaProblems`' doctrine half — the console's per-rule Principle column stays complete.
 *
 * SAME DEFECT, ONE TIER OVER. `DOCTRINE_META` holds copy that exists nowhere else in the tree,
 * and a rule with no row falls back to an empty principle: it renders with a blank description
 * while every count upstream reads correct. Two invariants shipped exactly that way before
 * `lawMetaProblems` existed, and 23 new rules is a much larger surface to lose one in.
 *
 * ⚠ THE CLASS ARM IS DIFFERENT FROM THE INVARIANTS'. An invariant's class is checked against
 * `LAW_CLASSES`, a vocabulary of six; a doctrine rule has no second taxonomy — its class IS its
 * pack — so the check is an EQUALITY against the pack in its own key. That catches the copy
 * error a six-way vocabulary cannot: a row pasted from the pack above it, keeping the class of
 * the pack it came from, which would colour the row and label its chip with the wrong pack.
 */
export function doctrineMetaProblems(addrs) {
  const page = path.join(ROOT, 'web', 'src', 'pages', 'Laws.jsx');
  let text;
  try { text = readText(page); } catch (e) {
    return [`[authoring] web/src/pages/Laws.jsx unreadable: ${e.message}`];
  }
  const block = /^const DOCTRINE_META = \{$([\s\S]*?)^\}$/m.exec(text);
  if (!block) {
    return ['[authoring] DOCTRINE_META literal not found in web/src/pages/Laws.jsx — the '
      + "console's doctrine rows would have no gate on their Principle column"];
  }
  const meta = new Map();
  for (const m of block[1].matchAll(DOCTRINE_META_ROW)) meta.set(m[2], [m[4], m[6]]);
  const problems = [];
  const seen = new Set();
  for (const addr of addrs) {
    seen.add(addr);
    if (!meta.has(addr)) {
      problems.push(`[authoring] doctrine rule ${addr} has no row in DOCTRINE_META `
        + '(web/src/pages/Laws.jsx) — the console would render it with a blank Principle');
      continue;
    }
    const [klass, principle] = meta.get(addr);
    if (!principle.trim()) {
      problems.push(`[authoring] DOCTRINE_META['${addr}'] has an empty principle line — that `
        + 'rule would render with a blank description');
    }
    const pack = addr.split('.')[0];
    if (klass !== pack) {
      problems.push(`[authoring] DOCTRINE_META['${addr}'] carries pack '${klass}' — a doctrine `
        + `rule's class IS its pack, so this must read '${pack}'`);
    }
  }
  for (const addr of [...meta.keys()].filter((k) => !seen.has(k)).sort()) {
    problems.push(`[authoring] DOCTRINE_META lists ${addr} but no pack file defines it`);
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
  const { laws, agents, skills, plugins } = counts;

  for (const m of readme.matchAll(/(\d+) universal laws/g)) {
    if (Number(m[1]) !== laws) {
      problems.push(`[authoring] README prose says '${m[1]} universal laws' but src has ${laws}`);
    }
  }
  // The README plugin count. It had drifted — the overview sentence said six while seven
  // shipped — because the project's other plugin count ({N_PLUGINS} in the web docs) reads
  // a DEPLOYED plugins dir that a markdown file in this repository never has. `plugins` is
  // optional in `counts` (Python's `.get`, undefined here) because the corpus predates it.
  if (plugins !== undefined) {
    for (const m of readme.matchAll(/(\d+) \*{0,2}plugins/g)) {
      if (Number(m[1]) !== plugins) {
        problems.push(`[authoring] README prose says '${m[1]} plugins' but `
          + `adapters/opencode/plugins has ${plugins}`);
      }
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

  // ⚠ THE ABSENCE OF THIS TRIPLE IS CHECKED BY THE CALLER, NOT HERE, AND THAT IS FORCED RATHER
  // THAN CHOSEN. This arm is satisfiable by DELETING THE SENTENCE — no match, no problem, green
  // — which is a gate failing open. The obvious fix is an `else` right here, and it cannot go
  // here: `prose_mirror_problems` is one of the pure functions recorded in
  // `tests/__snapshots__/primitives/`, the recording holds a case that passes an EMPTY `shipped`
  // and expects `[]`, and there is no recorder left to re-bless it. So the presence check lives
  // in `countTableProblems`, which is not recorded — beside the read that already knows whether
  // the file could be opened at all, which is where it reads better anyway.
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

// The doctrine twins of `LAW_HEADING_RE`, over the UNRENDERED source — `js/inventory.mjs`'s
// pair of the same names read the rendered form. A citation is the heading minus its `### `,
// so one regex cannot serve both: a heading is an anchored line, a citation is anywhere.
const DOCTRINE_HEADING_RE = /^### \{\{DOCTRINE\}\} ([a-z]+) (\d+)\b/gm;
const DOCTRINE_CITE_RE = /\{\{DOCTRINE\}\}\s+([a-z]+)\s+(\d+)/g;
// `\{\{DOCTRINE\}\}` and not `DOCTRINE`: `{{DOCTRINES}}` is the SECTION noun and is legal
// everywhere, including in an invariant that points at the tier as a whole.
const DOCTRINE_TOKEN_RE = /\{\{DOCTRINE\}\}/;
const DOC_TOKEN_RE = /\{\{(DOC_[A-Z0-9_]+)\}\}/g;

/**
 * A line reported by the doctor that is NOT a failure — `[note] …` rather than `[authoring] …`.
 *
 * ⚠ ONE PRODUCER, AND IT IS THE ONLY THING THAT NEEDED A SECOND CHANNEL. A build with a
 * doctrine pack off is LEGAL, and it leaves body prose citing rules that pack owns. That state
 * has to be visible — a silent dangling citation is how prose and boundary drift apart — but
 * reporting it as a problem would make `doctor` exit 1 over a configuration its owner chose.
 * So `cmdDoctor` prints notes and does not count them.
 */
const NOTE = '[note] ';
export const isDoctorNote = (p) => p.startsWith(NOTE);

/**
 * The three-tier constitution's own authoring gates — the doctrine twin of the `LAW_CLASS` /
 * `LAW_META` family, plus the two purity rules the tiering rests on.
 *
 * IT LIVES BESIDE `countTableProblems` RATHER THAN INSIDE IT, and is called from
 * `authoringProblems` beside `registry`/`secret`/`vendorPin`. `countTableProblems` opens by
 * reading `AGENT.md.tmpl` and HARD-RETURNS if that read fails, so an arm placed inside it
 * would go quiet on exactly the tree that is most broken. Nothing here needs the template's
 * tables, and `proseMirrorProblems` — the frozen recording — is untouched either way.
 *
 * ⚠ THE VOCABULARY GATES ARE HERE BECAUSE `themeParityProblems` CANNOT SEE THEM. That check is
 * presence-only and SYMMETRIC over the union of every theme's keys: a key missing from all
 * fourteen is in parity, and a key whose VALUE breaks a parser is not its business at all. So
 * `DOC_*` coverage, the `LEX_I..LEX_IX` equality and the single-word tier noun each need a gate
 * that reads the SOURCE and asks what the source requires.
 */
export function constitutionProblems() {
  const problems = [];
  const dir = path.join(SRC, 'doctrines');

  // ---- the packs themselves: present, contiguous from 1, and filed where they say they are.
  const rules = new Map();                                    // 'craft.1' -> title-less marker
  for (const pack of PACK_ORDER) {
    const file = path.join(dir, `${pack}.md`);
    let text;
    try { text = readText(file); } catch (e) {
      problems.push(`[authoring] doctrines/${pack}.md is named in PACK_ORDER but unreadable: `
        + `${e.message} — the build ships the whole catalogue, so a missing pack file breaks `
        + 'every citation into it, active or not');
      continue;
    }
    const found = [...text.matchAll(DOCTRINE_HEADING_RE)];
    if (!found.length) {
      problems.push(`[authoring] doctrines/${pack}.md carries no '### {{DOCTRINE}} ${pack} <n>' `
        + 'heading — the pack would render as an empty section');
      continue;
    }
    found.forEach(([, named, n], i) => {
      if (named !== pack) {
        problems.push(`[authoring] doctrines/${pack}.md holds a rule addressed to '${named} `
          + `${n}' — a rule's pack is read from its heading, so this one is unreachable at `
          + `'${pack}.${n}' and shadows whatever ${named}.md numbers ${n}`);
      }
      if (Number(n) !== i + 1) {
        problems.push(`[authoring] doctrines/${pack}.md rule ${n} is at position ${i + 1} — `
          + 'pack ids must run contiguously from 1, or a citation addresses a gap');
      }
      rules.set(`${named}.${Number(n)}`, true);
    });
  }

  // The console's Principle column, keyed off the rules just parsed — so the gate is driven by
  // the SOURCE and a rule added to a pack file is caught the same day, not when someone
  // notices a blank description in the browser.
  problems.push(...doctrineMetaProblems([...rules.keys()]));

  // ---- `--exclude-rules` closes against the SAME rules this walk just found.
  //
  // `knownRuleIds` is what the CLI flag, the console's trust boundary and every wizard prompt
  // validate an address against; the walk above is what the constitution actually renders.
  // Two readers of one directory is the shape that lets a rule be authored, rendered, cited —
  // and rejected by the only flag that can switch it off, with `invalid choice` naming a set
  // that visibly contains it. An equality, not containment: a stale id in the enumerator is a
  // rule the console offers a switch for and the build cannot drop.
  const enumerated = knownRuleIds();
  const walked = [...rules.keys()];
  for (const id of enumerated.filter((i) => !walked.includes(i))) {
    problems.push(`[authoring] knownRuleIds() offers '${id.replace('.', ' ')}', which no pack `
      + 'file defines — --exclude-rules accepts an address the build cannot drop');
  }
  for (const id of walked.filter((i) => !enumerated.includes(i))) {
    problems.push(`[authoring] doctrine ${id.replace('.', ' ')} is defined but knownRuleIds() `
      + 'does not offer it — --exclude-rules refuses a rule that exists, and the console has '
      + 'no switch for it');
  }

  // ---- the consent gate's address still names the consent rule.
  //
  // ⚠ THE ONE HARDCODED ADDRESS IN THE CODEBASE, and the one whose drift is silent AND unsafe.
  // `js/settings.mjs` keys the git-gate hooks on `process.5` by literal; a renumber of the
  // process pack moves that rule's neighbours under it, and the boundary would then follow
  // whatever rule inherited the number while the prompt still said `process 5`. Checked
  // against the pack file's own title token rather than against prose, so a reworded rule is
  // not a false alarm and a MOVED one is not a silent pass.
  const consentTitle = 'DOC_PROCESS_5';
  let processText = '';
  try { processText = readText(path.join(dir, 'process.md')); } catch { /* reported above */ }
  if (processText && !new RegExp(`^### \\{\\{DOCTRINE\\}\\} process 5 — \\{\\{${consentTitle}\\}\\}`,
    'm').test(processText)) {
    problems.push('[authoring] js/hosts/settings.mjs gates git commit/push on doctrine \'process 5\', '
      + `but doctrines/process.md does not number {${consentTitle}} 5 — the tool boundary and `
      + 'the prompt now name different rules');
  }

  // ---- every `{{DOCTRINE}} <pack> <n>` anywhere in src/ resolves to a rule that exists.
  //
  // The whole tree, not the template: a skill footer citing `process 9` is as broken as a
  // template one, and it is the shape 339 rewired citations could have left behind.
  const cited = new Map();                                    // 'process.5' -> [rel, …]
  for (const p of rglob(SRC)) {
    if (!isFile(p) || !(p.endsWith('.md') || p.endsWith('.tmpl'))) continue;
    let text;
    try { text = readText(p); } catch { continue; }
    const rel = path.relative(SRC, p).split(path.sep).join('/');
    // ⚠ AN ALWAYS-ON TIER MAY NEVER CITE A TOGGLEABLE ONE (D2). A `--doctrines craft` build
    // ships invariants that point at rules its AGENT.md does not contain; the ontology is
    // worse still, being the tier that states the order the others sit in. Doctrine->doctrine
    // citations are fine and stay: the full catalogue ships in every bundle.
    if ((rel.startsWith('ontology/') || rel.startsWith('laws/')) && DOCTRINE_TOKEN_RE.test(text)) {
      problems.push(`[authoring] ${rel} cites {{DOCTRINE}} — an always-on tier may never `
        + 'reference a toggleable one, or a pack-off build ships a rule pointing at text '
        + 'that is not there. State the point directly instead');
    }
    for (const [, pack, n] of text.matchAll(DOCTRINE_CITE_RE)) {
      const key = `${pack}.${Number(n)}`;
      if (!cited.has(key)) cited.set(key, []);
      cited.get(key).push(rel);
    }
  }
  for (const [key, where] of [...cited].sort()) {
    if (rules.has(key)) continue;
    problems.push(`[authoring] ${where[0]} cites {{DOCTRINE}} ${key.replace('.', ' ')}, which `
      + `no pack file defines${where.length > 1 ? ` (and ${where.length - 1} more)` : ''}`);
  }

  // ---- the vocabulary every theme owes the source.
  const wanted = new Set();
  for (const pack of PACK_ORDER) {
    let text;
    try { text = readText(path.join(dir, `${pack}.md`)); } catch { continue; }
    for (const [, key] of text.matchAll(DOC_TOKEN_RE)) wanted.add(key);
  }
  const lexWant = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX'].map((r) => `LEX_${r}`);
  // `_TEMPLATE.json` is included — it is the file `--sync-themes` seeds a new theme from, so a
  // stale key there propagates into every voice added afterwards. `themeFiles()` excludes it.
  const files = [...themeFiles(), path.join(THEMES, '_TEMPLATE.json')];
  for (const f of files) {
    const name = path.basename(f);
    let theme;
    try { theme = parseJson(readText(f)); } catch (e) {
      problems.push(`[authoring] ${name} unreadable: ${e.message}`);
      continue;
    }
    if (!theme || typeof theme !== 'object' || Array.isArray(theme)) continue;
    const keys = Object.keys(theme);
    for (const key of [...wanted].sort()) {
      if (!Object.hasOwn(theme, key)) {
        problems.push(`[authoring] ${name} has no {${key}} — a doctrine file names it, and `
          + 'theme parity cannot see a key that is missing from every theme at once');
      }
    }
    for (const key of keys.filter((k) => k.startsWith('DOC_')).sort()) {
      if (!wanted.has(key)) {
        problems.push(`[authoring] ${name} defines {${key}}, which no doctrine file uses — a `
          + 'dead voice key ships a title for a rule that does not exist');
      }
    }
    // I1 — an EQUALITY, not a presence check. The renumber left `LEX_XXII`, `LEX_XXIII`,
    // `LEX_XXIV` and `LEX_XXXVI` behind in all fifteen files, and parity was silent because
    // they were absent from nowhere.
    const lex = keys.filter((k) => k.startsWith('LEX_')).sort();
    const stale = lex.filter((k) => !lexWant.includes(k));
    const missing = lexWant.filter((k) => !lex.includes(k));
    for (const k of stale) {
      problems.push(`[authoring] ${name} still defines {${k}} — the invariants are I..IX and `
        + 'nothing renders this key, so it is a title for a rule that no longer exists');
    }
    for (const k of missing) {
      problems.push(`[authoring] ${name} has no {${k}} — one of the nine invariants would `
        + 'render with an empty title');
    }
    // M10 — ⚠ BOTH HEADING PARSERS MATCH THE TIER NOUN WITH `\S+`. A two-word value does not
    // error; the heading stops matching and the tier silently parses to nothing. `_TEMPLATE`'s
    // values are descriptive placeholders, so only real voices are held to this.
    if (name === '_TEMPLATE.json') continue;
    for (const key of ['LAW', 'DOCTRINE']) {
      const v = theme[key];
      if (typeof v === 'string' && /\s/.test(v)) {
        problems.push(`[authoring] ${name} spells {${key}} as ${pyRepr(v)} — the heading `
          + 'parsers match the tier noun with \\S+, so a value with a space makes every '
          + `${key === 'LAW' ? 'invariant' : 'doctrine rule'} parse to nothing, in silence`);
      }
    }
  }

  // ---- every `§N` in src/ addresses a section the template actually declares.
  //
  // ⚠ THIS GATE IS NARROW AND SAYS SO. Inserting `## 2. Doctrines` pushed every later section
  // down one, and the sweep that fixed the template's own cross-references stopped at the
  // template — four satellites under `src/skills/` and `src/agents/` kept pointing at the
  // section that used to be there, and they RENDER INTO EVERY BUNDLE. A range check would not
  // have caught those: §7 still existed, it had just stopped being the Wiki.
  //
  // What it does catch is the other half of a renumber — a pointer past the end, which is what
  // REMOVING a section leaves behind — and it is nearly free. The half it cannot catch is a
  // judgement about intent, and `docs/extending.md` carries the manual sweep for it. Naming
  // that limit here is the point: a reader who assumes this gate is total will skip the sweep.
  const declared = new Set();
  // Read here rather than borrowing `countTableProblems`' copy: that function hard-returns when
  // the template is unreadable, and this gate must not inherit a silence it did not choose.
  let tmpl = '';
  try { tmpl = readText(path.join(SRC, 'AGENT.md.tmpl')); } catch { tmpl = ''; }
  for (const [, n] of tmpl.matchAll(/^## (\d+)\.\s/gm)) declared.add(Number(n));
  if (declared.size) {
    for (const p of rglob(SRC)) {
      if (!isFile(p) || !(p.endsWith('.md') || p.endsWith('.tmpl'))) continue;
      let text;
      try { text = readText(p); } catch { continue; }
      const rel = path.relative(SRC, p).split(path.sep).join('/');
      for (const [, n] of text.matchAll(/§(\d+)/g)) {
        if (declared.has(Number(n))) continue;
        problems.push(`[authoring] ${rel} cites AGENT.md §${n}, and the template declares no `
          + `such section ${pyRepr([...declared].sort((a, b) => a - b).map(String))} — a `
          + 'renumber moved it, and this pointer renders into every bundle');
      }
    }
  }

  // ---- the build default names packs that exist.
  let cfgDoctrines = null;
  try {
    const cfg = parseJson(readText(CONFIG));
    if (cfg && typeof cfg === 'object' && Array.isArray(cfg.doctrines)) cfgDoctrines = cfg.doctrines;
  } catch { /* no config, or unreadable — `configDefaults()` is forgiving here too */ }
  if (cfgDoctrines) {
    for (const pack of cfgDoctrines) {
      if (!PACK_ORDER.includes(pack)) {
        problems.push(`[authoring] harness.config.json names doctrine pack ${pyRepr(pack)}, `
          + `which this checkout does not ship ${pyRepr([...PACK_ORDER])} — every build reading `
          + 'that default would fail');
      }
    }
  }

  // ---- D5, a NOTE and not a problem: what a narrowed default leaves pointing at the shelf.
  const on = cfgDoctrines ?? [...PACK_ORDER];
  const dangling = [...cited].filter(([k]) => rules.has(k) && !on.includes(k.split('.')[0]));
  if (dangling.length) {
    const packs = [...new Set(dangling.map(([k]) => k.split('.')[0]))].sort();
    problems.push(`${NOTE}harness.config.json builds ${pyRepr(on)}, and ${dangling.length} `
      + `citation(s) in src/ point into ${packs.join(', ')}. Those rules still SHIP — every `
      + 'pack file is in the bundle — so the reference resolves on disk; it is the rendered '
      + 'AGENT.md that will not contain them. Legal, and recorded here so it is not silent');
  }
  return problems;
}

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
    problems.push(`[authoring] skills/${missing}.md has no category in SKILL_CLASS`);
  }
  for (const stale of Object.keys(SKILL_CLASS).filter((s) => !skillFiles.has(s)).sort()) {
    problems.push(`[authoring] SKILL_CLASS lists '${stale}' but no skills/${stale}.md exists`);
  }

  const lawsMd = path.join(SRC, 'laws', 'universal.md');
  const lawNums = isFile(lawsMd)
    ? [...readText(lawsMd).matchAll(LAW_HEADING_RE)].map((m) => m[1]) : [];
  for (const num of lawNums) {
    if (!has(LAW_CLASS, num)) {
      problems.push(`[authoring] laws/universal.md rule ${num} has no class in LAW_CLASS`);
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
    // Last on purpose: the badge loop below walks this object in insertion order and the
    // message sequence is compared byte for byte against the Python implementation.
    plugins: existsSync(PLUGIN_SRC)
      ? readdirSync(PLUGIN_SRC).filter((f) => f.startsWith('geneseed-') && f.endsWith('.js')).length
      : 0,
  };
  let readme;
  try { readme = readText(path.join(ROOT, 'README.md')); } catch { return problems; }
  // ⚠ PRESENCE FIRST, THEN THE VALUE — the same absence arm the SHIPPED triple needed, for the
  // same reason: `if (m && …)` is green when there is no badge, so deleting a badge silences its
  // own gate. The `continue` keeps the loop's MESSAGE ORDER intact, which is load-bearing (see
  // the `plugins`-is-last comment above): a missing badge reports in its own slot rather than
  // reordering the ones after it.
  for (const [key, n] of Object.entries(counts)) {
    const m = new RegExp(`badge/${key}-(\\d+)`).exec(readme);
    if (!m) {
      problems.push(`[authoring] README has no ${key} badge — deleting one is how this gate `
        + 'goes green while the reader is told nothing');
      continue;
    }
    if (Number(m[1]) !== n) {
      problems.push(`[authoring] README ${key} badge says ${m[1]} but src has ${n}`);
    }
  }

  // WHERE THE ONBOARDING COPY LIVES, AND WHY THIS READ MOVED. It used to open the one module
  // that held the web console's onboarding prose. That prose has since moved into
  // `docs/web/*.md`, and the counts in it render from `{N_LAWS}` / `{N_AGENTS}` / `{N_SKILLS}`
  // — so the read was still succeeding against a file the sentences had left, all three arms
  // below scored zero, and the check looked healthy while gating nothing. A templated count
  // cannot drift; what these arms still catch is a maintainer typing the NUMBER into a page
  // instead of the token, which is the drift that reaches a reader.
  //
  // MEASURED BEFORE AND AFTER: zero problems either way on the shipped tree, so no recorded
  // byte moves. `web` stays fail-soft — a missing docs tree is not an authoring fault.
  let web = '';
  try {
    web = globSorted(path.join(ROOT, 'docs', 'web'), (n) => n.endsWith('.md'))
      .map(readText).join('\n');
  } catch { web = ''; }
  // ⚠ NOT FAIL-SOFT, UNLIKE `web` ABOVE, AND THE ASYMMETRY IS THE POINT. A missing `docs/web`
  // tree is not an authoring fault — a checkout can legitimately lack it. SHIPPED.md is a
  // tracked, shipped file that this function asserts the CONTENT of, so an unreadable one is
  // indistinguishable from a deleted claim: swallowing it into `''` used to hand the triple arm
  // an empty string and turn a hard read failure into a silent pass.
  // ⚠ NOT FAIL-SOFT, UNLIKE `web` ABOVE, AND THE ASYMMETRY IS THE POINT. A missing `docs/web`
  // tree is not an authoring fault — a checkout can legitimately lack it. SHIPPED.md is a
  // tracked, shipped file whose CONTENT this function asserts, so an unreadable one was
  // indistinguishable from a deleted claim: swallowing it into `''` handed the triple arm an
  // empty string and turned a hard read failure into a silent pass.
  //
  // AND THE PRESENCE OF THE TRIPLE IS CHECKED HERE rather than inside `proseMirrorProblems`,
  // which is where it belongs by subject and cannot go by construction — that function is
  // recorded in `tests/__snapshots__/primitives/` with a case that passes an empty `shipped` and
  // expects `[]`, and nothing can re-bless a recording whose recorder is deleted. This is the
  // caller, it is not recorded, and it already owns the question "could the file be read".
  let shipped;
  try {
    shipped = readText(path.join(ROOT, 'SHIPPED.md'));
  } catch (e) {
    problems.push(`[authoring] SHIPPED.md is unreadable (${e.message}) — the counts it carries `
      + 'cannot be checked, and a gate that cannot read its subject must say so');
    shipped = '';
  }
  if (shipped && !/(\d+) laws, (\d+) agents, (\d+) skills/.test(shipped)) {
    problems.push('[authoring] SHIPPED.md carries no \'N laws, N agents, N skills\' line — '
      + 'deleting it is how that gate goes green while the count drifts');
  }
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
    // "the harness", not `harness.py`: both implementations load this literal, and the file
    // the old wording named is the one this migration deletes. Moved on both sides at once —
    // these two strings are byte-compared by the live doctor comparison.
    problems.push('[authoring] LEARN_PROMPT_HEAD literal not found in '
      + 'geneseed-learn.js — the harness would fall back (single source broken)');
  } else if (m[1] !== loadLearnPromptHead()) {
    problems.push('[authoring] LEARN_PROMPT_HEAD drifted between geneseed-learn.js '
      + "and the harness's loaded copy");
  }
  const node = pyWhich('node');
  if (node) {
    for (const js of globSorted(PLUGIN_SRC, (n) => n.endsWith('.js'))) {
      // THE ONE SPAWN. `node --check` and nothing else — see the module header, and
      // `test_the_cli_spawns_only_a_node_syntax_check`, which names this argv.
      // `NO_WINDOW` because the reference's `run()` folds `CREATE_NO_WINDOW` into every
      // CAPTURING spawn and this is one — and because this loop is the burst a user sees:
      // one console window per plugin, every time the web daemon runs the doctor.
      const r = spawnSync(node, ['--check', js], { encoding: 'utf-8', ...NO_WINDOW });
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
  problems.push(...constitutionProblems());
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
function withTempDir(fn, prefix = 'geneseed-doctor-') {
  const tmp = mkdtempSync(path.join(os.tmpdir(), prefix));
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
  // P10c's `cli` check is GONE, and the reason is not that it stopped mattering. It hashed
  // `rituals/harness.py` and compared that against a digest baked into `cli.json`, to catch a
  // parser edited without regenerating the table. P2 made the table the OWNED document
  // (`js/cli-table.json`), so there is no generator to fall behind and no second file to hash
  // — the digest was a claim about a file this migration deletes. What replaces it is
  // `tests/test_cli_reference.py`'s argparse-vs-table equality, for as long as the parser is
  // still here to walk.
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
  const [themes, collected] = doctorCollect({
    theme: args.theme, allThemes: Boolean(args.all), bundle: args.bundle,
    noBundle: Boolean(args.noBundle),
  });
  if (!themes.length) {
    pyPrint(`${collected.length ? collected[0] : '[doctor] no themes found'}\n`);
    return 1;
  }
  // ⚠ NOTES ARE PRINTED AND NOT COUNTED. The only producer is the pack-off citation report in
  // `constitutionProblems`, and the state it describes is one the install's owner chose: a
  // build that leaves body prose citing a pack it did not render. Silence there is how prose
  // and boundary drift apart, and a non-zero exit there is doctor failing a legal
  // configuration. Nothing in the recorded CLI corpus produces one — the checkout's own
  // `harness.config.json` names no packs — so the byte-compared output is unmoved.
  const notes = collected.filter(isDoctorNote);
  const problems = collected.filter((p) => !isDoctorNote(p));
  const scoped = !args.theme && !args.all && themes.length === 1;
  const note = scoped
    ? `  (scoped to installed theme '${themes[0]}'; run with --all to sweep every theme)` : '';
  for (const n of notes) pyPrint(`${n}\n`);
  if (problems.length) {
    pyPrint(`[doctor] ${problems.length} problem(s) across ${themes.length} theme(s):\n`);
    for (const p of problems) pyPrint(`  - ${p}\n`);
    if (problems.some((p) => p.includes('dead link'))) {
      pyPrint('  tip: dead links to skills mean your source is incomplete — run '
        + '`./geneseed update` (or re-sync src/), then re-check.\n');
    }
    if (problems.some((p) => p.startsWith('[themes]') && p.includes('missing key'))) {
      // ⚠ THE TIP USED TO NAME `./geneseed build --sync-themes`, AND THAT COMMAND ERRORS.
      // It was argued here on the premise that "`build` forwards its extra arguments to the
      // generator" — which was true of the reference and is not true of `cmdBuild`
      // (`js/generate.mjs`), which forwards `--theme` and nothing else. So the front door
      // answered `unrecognized arguments: --sync-themes` to anyone who followed doctor's own
      // advice, for as long as the premise went unchecked. The flag belongs to the GENERATOR,
      // whose binary is `geneseed-build` — which is what `README.md` and `SETUP.md` have said
      // all along. A hint is a command; if it is not runnable it is decoration.
      pyPrint('  tip: a theme is missing a key another theme defines — run '
        + '`geneseed-build --sync-themes` to fill it from _TEMPLATE.json, '
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

// --------------------------------------------------------------------------------------
// validate  —  the generator's `--validate-only`, on this binary because it runs the doctor
// --------------------------------------------------------------------------------------

/**
 * `build._validate_sandbox_problems` — the unresolved-token / dead-link / non-hermetic-link
 * scan over an already-rendered sandbox tree.
 *
 * A NEAR-TWIN OF `checkBuild` ABOVE, AND DELIBERATELY NOT IT, because the reference is two
 * functions and they differ in three observable ways: the token list is `sorted(set(...))`
 * here and bare `set(...)` there, the message carries no `[theme]` prefix (the caller adds
 * `[emit]` instead), and an unreadable file is SKIPPED rather than raised. Python duplicates
 * the loop because `build.py` cannot import the harness tree; here the two live in one file
 * and the duplication is eight lines — every primitive underneath (`rglob`, `stripCode`,
 * `linkProblems`, `readText`) is the shared one, which is the half that could actually drift.
 */
export function validateSandboxProblems(sandbox) {
  const out = pyResolve(sandbox);
  const problems = [];
  for (const md of rglob(out)) {
    if (!md.endsWith('.md') || !isFile(md)) continue;
    const rel = path.relative(out, md);
    if (validateIsVendored(rel)) continue;
    let text;
    // `except (OSError, UnicodeDecodeError): continue` — binary or unreadable, nothing here.
    try { text = readText(md); } catch { continue; }
    for (const tok of sortedUnique(text.match(TOKEN_RE) ?? [])) {
      problems.push(`unresolved token ${tok} in ${rel}`);
    }
    problems.push(...linkProblems(md, text, out, rel));
  }
  return problems;
}

/**
 * `subprocess.run(..., capture_output=True, text=True)` around an IN-PROCESS call.
 *
 * The reference shells to `harness.py doctor`; this calls `cmdDoctor` directly, and the
 * difference has to be undone in one place: a child's `capture_output` hands the parent
 * UNIVERSAL-NEWLINE text, so `r.stdout` holds `\n` on Windows even though the child wrote
 * `\r\n`. `pyPrint` inside `cmdDoctor` writes `\r\n`. Without the fold, the `.strip()` below
 * would leave every interior line CRLF and the re-print would double the translation.
 */
function captureStreams(fn) {
  const chunks = { out: [], err: [] };
  const realOut = process.stdout.write.bind(process.stdout);
  const realErr = process.stderr.write.bind(process.stderr);
  process.stdout.write = (c) => { chunks.out.push(String(c)); return true; };
  process.stderr.write = (c) => { chunks.err.push(String(c)); return true; };
  let code;
  try {
    code = fn();
  } finally {
    process.stdout.write = realOut;
    process.stderr.write = realErr;
  }
  const decode = (xs) => xs.join('').replaceAll('\r\n', '\n').replaceAll('\r', '\n');
  return { code, out: decode(chunks.out), err: decode(chunks.err) };
}

/**
 * `build._validate_only` — render + emit the requested target into a throwaway sandbox, run
 * every validation a real build would gate on, print what WOULD have been written, and return
 * the exit code. Nothing under the sandbox survives, and no marker, manifest or registry row
 * is ever written for real.
 *
 * WHY IT IS HERE AND NOT ON THE GENERATOR DRIVER, which is where its flag lives. The
 * source-tree half of the check IS the doctor, and this module starts a process (`node --check`
 * over the OpenCode plugins). `bin/build-driver.mjs` is under a transitive ban on reaching any
 * module that can, gated twice — `tests/test_node_cli_parity.py` greps the driver's source and
 * `tests/test_hook_cli_parity.py` walks its relative imports. Siting the tool on the CLI
 * binary, which already carries the doctor, crosses it with neither gate amended and without
 * the dynamic `import()` that would evade the walk.
 *
 * THE MARKER GUARANTEE COMES FREE, and that is why `emitProjectInto`/`emitGlobalInto`/
 * `buildInto` are used rather than `driverMain(['--emit', …])`: the driver writes
 * `.geneseed-emit`/`.geneseed-footprint` and records an install-registry row AFTER the
 * dispatch, so routing through it would register a temp directory that is deleted a
 * millisecond later. The reference calls the emit functions directly for the same reason.
 *
 * THE EMIT'S OWN STDOUT IS NOT SWALLOWED. `globalEmitProblems` above wraps its call in
 * `swallowStdout` and this deliberately does not: `_validate_only` has no `redirect_stdout`,
 * so the ~200 lines of emit summary ARE part of what a dry run shows the operator.
 *
 * NO CELL CAN REACH THIS. `golden.py`'s `_argv` never emitted `--validate-only`, so the flag
 * was ungated across implementations for the whole port; the gate is the corpus in
 * `tests/test_maintainer_tools_parity.py`, which runs the reference and this side over the
 * same flags and compares stdout, stderr and the exit code.
 */
export function cmdValidate(args) {
  const problems = [];
  const scan = withTempDir((tmpRaw) => {
    // `.resolve()` mirrors `_check_build`'s: on Windows a temp dir can come back in 8.3
    // short form (`RUNNER~1`) while every link TARGET below is resolved long-form, and
    // `within` then rejects every relative link rather than only the escaping ones.
    const tmp = pyResolve(tmpRaw);
    // With a distinct `--root` the per-repo emits split their output — the bundle under
    // `out`, the native layer under `root` — so the sandbox bundle nests INSIDE the sandbox
    // root and the scan covers both layers.
    const root = args.root ? path.join(tmp, 'root') : path.join(tmp, 'out');
    const sandbox = args.root ? path.join(root, 'bundle') : root;
    const cfgDir = path.join(tmp, 'cfg');
    const emit = args.emit;
    const opts = { theme: args.theme, footprint: args.footprint };
    let scanDirs;
    try {
      if (emit.endsWith('-global')) {
        emitGlobalInto(emit.slice(0, -'-global'.length), { ...opts, out: sandbox, cfgDir });
        scanDirs = [cfgDir];
      } else if (emit === 'files') {
        buildInto({ ...opts, out: sandbox });
        scanDirs = [sandbox];
      } else {
        emitProjectInto(emit, { ...opts, out: sandbox, root });
        scanDirs = [root];
      }
    } catch (e) {
      // `except SystemExit as e` — a DELIBERATE refusal from the render (an unknown theme,
      // an incomplete source), interpolated as `{e}`.
      //
      // THE EXIT CODE AND NOT THE MESSAGE, measured rather than assumed: the reference's
      // render half is ALREADY this port. `_build_render.build` calls `_build_core.run_node`,
      // which ends `raise SystemExit(res.get("exit", 1))` — an INTEGER — so every refusal
      // that crosses the seam arrives here as `SystemExit(1)` and `str(e)` is `'1'`, not the
      // sentence `load_theme` wrote on stderr on the way out. A port that printed `e.message`
      // says `unknown theme 'x'` where the reference says `1`. The corpus in
      // `tests/test_maintainer_tools_parity.py` is what found it; nothing else could.
      if (e && e.exitCode !== undefined) {
        pyPrint(`[validate-only] render/emit FAILED for theme '${args.theme}' `
          + `emit '${emit}': ${e.exitCode}\n`);
        return null;
      }
      throw e;
    }

    const written = scanDirs.filter(isDir).flatMap((d) => rglob(d)).filter(isFile)
      .sort(comparePaths);
    pyPrint(`[validate-only] theme=${args.theme} emit=${emit} `
      + `footprint=${args.footprint}\n`);
    pyPrint(`[validate-only] would write ${written.length} file(s) under ${args.out}`
      + (args.root ? ` (root ${args.root})` : '')
      + ' — nothing was actually written (sandboxed).\n');
    if (args.verbose) {
      let base = scanDirs[0];
      for (const p of written) {
        for (const d of scanDirs) {
          if (within(p, d)) { base = d; break; }
        }
        pyPrint(`  would write: ${path.relative(base, p)}\n`);
      }
    }
    for (const d of scanDirs) {
      for (const p of validateSandboxProblems(d)) problems.push(`[${emit}] ${p}`);
    }
    return scanDirs;
  }, 'geneseed-validate-');
  if (scan === null) return 1;

  // The source-tree-wide checks (theme parity, authoring gates, AGENT.md table parity,
  // colour themes) do not depend on --out/--root/--emit at all and already live fully tested
  // in the doctor, so they run through it rather than being re-derived. The reference SHELLS
  // to `harness.py doctor --theme T --no-bundle`; one process is what this port has.
  const doctor = captureStreams(() => cmdDoctor({ theme: args.theme, noBundle: true }));
  if (pyStripSpace(doctor.out)) pyPrint(`${pyStripSpace(doctor.out)}\n`);
  if (pyStripSpace(doctor.err)) pyPrintErr(`${pyStripSpace(doctor.err)}\n`);
  if (doctor.code !== 0) {
    problems.push(`[doctor] source-tree validation failed for theme '${args.theme}' `
      + '(see output above)');
  }

  if (problems.length) {
    pyPrint(`[validate-only] ${problems.length} problem(s):\n`);
    for (const p of problems) pyPrint(`  - ${p}\n`);
    return 1;
  }
  pyPrint('[validate-only] ok — would render and emit cleanly, no problems found.\n');
  return 0;
}
