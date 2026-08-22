/**
 * The checks over the REPO's own records — the registry, committed secrets, the hook shim
 * and the vendored-skill pins.
 *
 * Same contract as `checks-build.mjs`: an array of problem strings, empty when clean, one
 * planted fault per check in the gate. This is the group that reads what the repo SAYS about
 * itself and compares it against what is on disk.
 */
import path from 'node:path';
import { PLUGIN_SRC, ROOT, SRC, THEMES, WORKFLOW_SRC } from '../build/source.mjs';
import { VENDORED_SKILL_DIRS } from '../hosts/native.mjs';
import { hookShimPath, shimDeadPaths } from '../hosts/settings.mjs';
import { readText } from '../lib/fs.mjs';
import { formatRepr, formatValue } from '../lib/json.mjs';
import { splitLines } from '../lib/udiff.mjs';
import { ENTITY_STATUSES } from './inventory.mjs';
import { has, isDir, isFile, rglob, srcStems } from './scan.mjs';
import { readFileSync } from 'node:fs';

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
    // lookup is `undefined`, which `formatRepr` would not recognise as one.
    if (!ENTITY_STATUSES.includes(row.status)) {
      problems.push(`[authoring] registry.json['${key}'].status ${formatRepr(row.status ?? null)} `
        + `is not one of ${formatRepr(ENTITY_STATUSES)}`);
    }
    if (!SEMVER_RE.test(formatValue(row.version ?? ''))) {
      problems.push(`[authoring] registry.json['${key}'].version `
        + `${formatRepr(row.version ?? null)} is not a semver (N.N.N)`);
    }
    if (!formatValue(row.owner ?? '').trim()) {
      problems.push(`[authoring] registry.json['${key}'] has no owner`);
    }
    for (const field of ['added', 'last_verified']) {
      const value = formatValue(row[field] ?? '');
      if (value && !ISO_DATE_RE.test(value)) {
        problems.push(`[authoring] registry.json['${key}'].${field} ${formatRepr(value)} is `
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
      splitLines(s).forEach((line, i) => {
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

