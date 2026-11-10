/**
 * `build` — render one theme's sources into a bundle directory, and the two checks that
 * decide whether it may.
 *
 * The LAYER BOTH HOST EMITS SIT ON, and that is why it is not in `emit.mjs` with them: the
 * first map left it there, and the derived imports came back with `emit-opencode.mjs` and
 * `emit-claude.mjs` importing `emit.mjs` while `emit.mjs` imported them back. A bundle is
 * produced before any host is chosen, so it belongs UNDER the emitters, not beside them.
 *
 * `assertSourceComplete` scans the TEMPLATE rather than the render, and the src-dirs marker
 * is how a re-emit knows which directory names the last one used.
 */
import path from 'node:path';
import { VERSION_MARKER } from '../hosts/hosts.mjs';
import { BUNDLE_FILES_KEY, bundleFiles, ownedWithin } from '../hosts/owned.mjs';
import { migrateMemoryIndex } from '../hosts/memory-files.mjs';
import { copyFile, isFile, readText, writeText } from '../lib/fs.mjs';
import { jsonDumpsIndent, parseJson, formatReprAscii, isTruthy } from '../lib/json.mjs';
import { OWNED_SRC_DIRS, SRC_DIRS_MARKER, TMPL_SPEC_RE } from './emit-common.mjs';
import { SRC_DIR_TOKENS, renderAll } from './render.mjs';
import {
  ensureBundleGitignore, ensureContextStub, ensureMemoryIndex, ensureNotebookIndex,
  ensureProfileStub, ensureRulesStub, ensureWikiStub,
} from './stubs.mjs';
import { writeVersion } from './version.mjs';
import {
  existsSync, mkdirSync, readdirSync, renameSync, rmdirSync, unlinkSync,
} from 'node:fs';

/**
 * Seed the memory index, then move a flat one to topics — the pair every emit runs on its
 * memory store, in that order. Here and not in `js/hosts/memory-files.mjs`: `stubs.mjs`
 * imports that module, so the reverse import would be a cycle.
 */
export function ensureMemoryStore(memDir) {
  ensureMemoryIndex(memDir);
  migrateMemoryIndex(memDir);
}

// ---------------------------------------------------------------------------
// Source completeness
// ---------------------------------------------------------------------------

/** `_build_render._missing_referenced_specs` — scans the TEMPLATE, not the render. */
function missingReferencedSpecs(cfg) {
  let tmpl;
  try {
    tmpl = readText(path.join(cfg.src, 'AGENT.md.tmpl'));
  } catch {
    return [];
  }
  const missing = new Set();
  for (const [, kind, name] of tmpl.matchAll(TMPL_SPEC_RE)) {
    const dir = kind.toLowerCase();
    if (name !== '_template' && !isFile(path.join(cfg.src, dir, `${name}.md`))) {
      missing.add(`${dir}/${name}.md`);
    }
  }
  return [...missing].sort();
}

/**
 * `_build_render.assert_source_complete`.
 *
 * The message goes to the
 * captured stderr buffer and the throw carries the exit code, which the driver turns
 * into a process status by `bin/build-driver.mjs`'s `main` — so the caller sees the same stream
 * bytes and the same exit status whichever runtime rendered.
 */
export function assertSourceComplete(cfg, context = '') {
  const missing = missingReferencedSpecs(cfg);
  if (!missing.length) return;
  const where = context ? ` (${context})` : '';
  process.stderr.write(
    `[geneseed][E-INCOMPLETE] ✗ source is incomplete${where}: AGENT.md references `
    + `${missing.length} spec(s) with no file under src/:\n`
    + missing.map((m) => `    - ${m}\n`).join('')
    + '[geneseed] ✗ Refusing to emit — a partial source would write dead links '
    + 'and a global re-emit would delete the good copies in an existing install.\n'
    + '[geneseed] ✗ Re-sync the source (./geneseed update, or re-run the upgrade) '
    + 'and try again.\n');
  throw Object.assign(new Error('source is incomplete'), { exitCode: 1 });
}

// ---------------------------------------------------------------------------
// The owned-dir marker
// ---------------------------------------------------------------------------

/** `_build_render._read_prior_src_dirs` — `{}` on anything unreadable or not an object. */
function readPriorSrcDirs(out) {
  let data;
  try {
    data = parseJson(readText(path.join(out, SRC_DIRS_MARKER)));
  } catch {
    return {};
  }
  return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
}

/**
 * `_build_render._write_src_dirs_marker` — temp + replace. `files` rides in the same marker:
 * every rel this build wrote, the stores apart (see `build`).
 */
function writeSrcDirsMarker(out, resolved, files) {
  const tmp = path.join(out, `${SRC_DIRS_MARKER}.tmp`);
  writeText(tmp, `${jsonDumpsIndent({ ...resolved, [BUNDLE_FILES_KEY]: files })}\n`);
  renameSync(tmp, path.join(out, SRC_DIRS_MARKER));
}

/** Remove now-empty directories from `dir` up to, never including, `out`. */
function pruneEmptyDirs(dir, out) {
  for (let d = dir; d !== out && d.startsWith(out + path.sep); d = path.dirname(d)) {
    try { if (readdirSync(d).length) return; rmdirSync(d); } catch { return; }
  }
}

/**
 * The guard on the prune of a RENAMED owned dir — `build`'s one destructive path driven
 * by file content rather than by code.
 *
 * `.geneseed-srcdirs.json` is a plain file a user (or another tool) can edit, and the
 * name in it is joined onto `out` and handed to a recursive delete. `".."` would take out
 * the bundle's PARENT, an absolute path replaces `out` entirely when joined, and
 * `"a/b"` reaches into nested content. Only a plain
 * single-segment name resolving directly under `out` is ever deleted.
 */
function safePriorDirName(out, priorName) {
  return typeof priorName === 'string'
    && priorName !== '.' && priorName !== '..'
    && !path.isAbsolute(priorName)
    && path.basename(priorName) === priorName
    && path.dirname(path.resolve(out, priorName)) === path.resolve(out);
}

// ---------------------------------------------------------------------------
// build
// ---------------------------------------------------------------------------

/**
 * THE PHASE BOUNDARY MARKER — T8, and the whole of what this port owes
 * `tests/unit/emit_phase_order.test.mjs`.
 *
 * Every emit runs its stages in one order: RENDER* → WIRE* → PRUNE → MANIFEST → VERIFY. RENDER
 * writes files Geneseed owns wholesale; WIRE reconciles files the USER co-owns (the
 * CLAUDE.md/AGENTS.md managed block, settings(.local).json, opencode.json) by reading what is
 * already there and merging into it. WIRE must precede MANIFEST because wiring is what fills the
 * `managed` record the manifest writes, and every teardown path unwires exactly what was wired.
 *
 * WHY A RUNTIME LOG AND NOT A SOURCE WALK. The reference gated this with five `ast` walks over
 * its own generator, and could, because it keeps `_claude_render` / `_claude_wire` as two
 * dispatchers and therefore two statements at every call site — a shape its own docstring calls
 * "not incidental, it is what leaves this walker something to check". THIS PORT DOES NOT HAVE
 * THAT SHAPE: `claudeWire` is a real function but the two OpenCode emits inline their merge
 * (`emitOpencodeRender`, `emitOpencodeGlobalRender`), and PRUNE/MANIFEST/VERIFY are not in this
 * module at all — they are in `bin/build-driver.mjs`'s driver bodies. A walker would have to span two
 * files and would still be reading source rather than watching a run.
 *
 * So the order is made OBSERVABLE instead, which is strictly the better gate: it reports what
 * actually executed, in the order it executed, including the branch a given host took.
 *
 * ⚠ BEHIND AN ENV VAR THE THREE REPLAYERS DO NOT SET, and that is the entire safety argument.
 * `cellEnv` clears every `GENESEED_*` knob by prefix, so no recorded cell can turn this on and
 * the emit corpus cannot move by one byte. It writes to STDERR, never stdout: stdout is the
 * decision channel every Geneseed hook signals through, and a stray byte there turns a blocking
 * gate into a silently permissive one.
 *
 * Read at CALL time, not at import, so one process can drive several emits under it.
 */
export function phaseLog(phase) {
  if (!process.env.GENESEED_PHASE_LOG) return;
  process.stderr.write(`[geneseed:phase] ${phase}\n`);
}

/**
 * `_build_render.build` — render the bundle into `out`.
 *
 * `out` arrives as an already-resolved STRING and is echoed into the progress lines
 * verbatim: it is backslash-separated on Windows, and re-deriving it here would differ by
 * separator in every message.
 */
export function build(cfg, themeName, out, { footprint = 'full', nativeCatalog = false } = {}) {
  phaseLog('RENDER');
  const { theme, items } = renderAll(cfg, themeName, { footprint, nativeCatalog });
  assertSourceComplete(cfg, `theme '${themeName}'`);
  mkdirSync(out, { recursive: true });

  // Ownership is per file — `bundleFiles` says why. `mine` is what the previous build wrote
  // here, or null when there is no record (a first render, or an older build's bundle).
  const isBundle = isFile(path.join(out, '.geneseed-theme')) || isFile(path.join(out, VERSION_MARKER));
  const priorSrcDirs = isBundle ? readPriorSrcDirs(out) : {};
  const prior = isBundle ? bundleFiles(out) : null;
  const mine = prior && new Set(prior);
  const resolvedSrcDirs = {};
  const ownedNames = new Set();
  for (const srcDir of OWNED_SRC_DIRS) {
    // `??` falls back on an explicit JSON null too. No theme has one.
    const dirname = theme[SRC_DIR_TOKENS[srcDir]] ?? srcDir;
    resolvedSrcDirs[srcDir] = dirname;
    ownedNames.add(dirname);

    // `isTruthy`, not `priorName &&`: the marker is user-editable JSON, and an
    // empty `[]`, `{}` or `0` must count as absent although JS's `&&` treats the first two
    // as set. Getting that wrong warns about a value that is silently skipped — reachable
    // only from a hand-edited file, which is the one place nobody would look for it.
    const priorName = priorSrcDirs[srcDir];
    if (isBundle && isTruthy(priorName) && priorName !== dirname) {
      // A theme renamed the dir: the old name's recorded files go in the prune below.
      if (safePriorDirName(out, priorName)) ownedNames.add(priorName);
      else {
        process.stderr.write('[geneseed] WARN: ignoring suspicious prior dir name '
          + `${formatReprAscii(priorName)} recorded in ${SRC_DIRS_MARKER} - not pruned.\n`);
      }
    }
  }

  // The prune: a recorded file under an owned dir that this render no longer ships. Before the
  // writes, as the whole-dir wipe it replaces was, so a rel that changed only in case is not
  // deleted after being written on a case-insensitive disk. `ownedWithin` contains the rels:
  // the marker is a file a user can edit.
  const shipped = new Set(items.map(({ rel }) => rel));
  for (const rel of ownedWithin(out, (prior ?? []).filter((r) => !shipped.has(r)))) {
    if (!ownedNames.has(rel.split('/')[0])) continue;
    const victim = path.join(out, rel);
    try {
      if (isFile(victim)) { unlinkSync(victim); pruneEmptyDirs(path.dirname(victim), out); }
    } catch (e) {
      process.stderr.write(`[geneseed] WARN: could not remove stale ${rel} (${e.message})\n`);
    }
  }

  const nbDirname = theme[SRC_DIR_TOKENS.notebook] ?? 'notebook';
  const memDirname = theme[SRC_DIR_TOKENS.memory] ?? 'memory';
  const written = [];
  const yours = [];
  for (const { rel, text, src } of items) {
    const dest = path.join(out, rel);
    // The notebook is the agent's sovereign space: seeded files are written once and
    // never re-emitted, so the agent may rewrite its own rules. Only `.gitignore` is
    // re-asserted — the one law it cannot lift.
    const parts = rel.split('/');
    const there = existsSync(dest);
    if (parts[0] === nbDirname && path.basename(rel) !== '.gitignore' && there) {
      continue;
    }
    // The two stores stand outside the claim and the record: their seeds are rewritten as
    // before, and nothing in them is ever removed, by a build or by an uninstall.
    const store = parts[0] === nbDirname || parts[0] === memDirname;
    // Claim-on-create. With a record, only a recorded file is overwritten. Without one, an
    // older build's bundle is overwritten as that build did, and in a folder that is no
    // bundle at all an existing file is the user's.
    if (there && !store && !(mine ? mine.has(rel) : isBundle)) { yours.push(rel); continue; }
    mkdirSync(path.dirname(dest), { recursive: true });
    if (text !== null) writeText(dest, text);
    else copyFile(src, dest);
    if (!store) written.push(rel);
  }
  if (yours.length) {
    // STDOUT, and ASCII-only: this print crashed with UnicodeEncodeError on a cp1252
    // Windows console when it carried a warning-sign emoji.
    const shown = yours.slice(0, 5).join(', ') + (yours.length > 5 ? `, and ${yours.length - 5} more` : '');
    process.stdout.write(`[geneseed] WARN: kept ${yours.length} existing file(s) Geneseed did not `
      + `write in ${out}, and skipped its own copy of each: ${shown}. Move one aside and `
      + 'rebuild to get Geneseed\'s copy.\n');
  }

  writeText(path.join(out, '.geneseed-theme'), `${themeName}\n`);
  writeVersion(cfg, out);
  writeSrcDirsMarker(out, resolvedSrcDirs, written.sort());
  ensureContextStub(out);
  ensureWikiStub(out);
  ensureRulesStub(out);
  ensureProfileStub(out);
  ensureBundleGitignore(out);
  ensureMemoryStore(path.join(out, theme[SRC_DIR_TOKENS.memory] ?? 'memory'));
  ensureNotebookIndex(path.join(out, theme[SRC_DIR_TOKENS.notebook] ?? 'notebook'));
  process.stdout.write(`[geneseed] built theme '${themeName}' -> ${out} (${items.length} files)\n`);
}

