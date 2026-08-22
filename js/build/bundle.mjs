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
import { copyFile, readText, writeText } from '../lib/fs.mjs';
import { jsonDumpsIndent, parseJson, formatReprAscii, isTruthy } from '../lib/json.mjs';
import { OWNED_SRC_DIRS, SRC_DIRS_MARKER, TMPL_SPEC_RE, isDir, isFile } from './emit-common.mjs';
import { SRC_DIR_TOKENS, renderAll } from './render.mjs';
import {
  ensureBundleGitignore, ensureContextStub, ensureMemoryIndex, ensureNotebookIndex,
  ensureProfileStub, ensureRulesStub, ensureWikiStub,
} from './stubs.mjs';
import { writeVersion } from './version.mjs';
import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';

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
 * Python raises `SystemExit(1)` after writing to stderr. Here the message goes to the
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
  const e = new Error('source is incomplete');
  e.exitCode = 1;
  throw e;
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

/** `_build_render._write_src_dirs_marker` — temp + replace. */
function writeSrcDirsMarker(out, resolved) {
  const tmp = path.join(out, `${SRC_DIRS_MARKER}.tmp`);
  writeText(tmp, `${jsonDumpsIndent(resolved)}\n`);
  renameSync(tmp, path.join(out, SRC_DIRS_MARKER));
}

/**
 * The guard on the prune of a RENAMED owned dir — `build`'s one destructive path driven
 * by file content rather than by code.
 *
 * `.geneseed-srcdirs.json` is a plain file a user (or another tool) can edit, and the
 * name in it is joined onto `out` and handed to a recursive delete. `".."` would take out
 * the bundle's PARENT, an absolute path replaces `out` entirely under Python's
 * `Path.__truediv__`, and `"a/b"` reaches into nested content. Only a plain
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
 * `_build_render.build` — render the bundle into `out`.
 *
 * `out` arrives as the STRING Python already resolved, and is echoed into the progress
 * lines verbatim: Python interpolates `str(Path)`, which is backslash-separated on
 * Windows, and re-deriving it here would differ by separator in every message.
 */
/**
 * THE PHASE BOUNDARY MARKER — T8, and the whole of what this port owes
 * `tests/test_emit_phase_order.py`.
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

export function build(cfg, themeName, out, { footprint = 'full', nativeCatalog = false } = {}) {
  phaseLog('RENDER');
  const { theme, items } = renderAll(cfg, themeName, { footprint, nativeCatalog });
  assertSourceComplete(cfg, `theme '${themeName}'`);
  mkdirSync(out, { recursive: true });

  // Wipe the owned dirs ONLY inside an established bundle: a first render into an
  // arbitrary repo (`--out .`) must never delete an agents/ or skills/ the USER owns.
  const isBundle = isFile(path.join(out, '.geneseed-theme')) || isFile(path.join(out, VERSION_MARKER));
  const priorSrcDirs = isBundle ? readPriorSrcDirs(out) : {};
  const resolvedSrcDirs = {};
  for (const srcDir of OWNED_SRC_DIRS) {
    // `theme.get(token, srcDir)` — `??` agrees with it except for an explicit JSON null,
    // where Python would go on to join `None` onto a path and raise. No theme has one.
    const dirname = theme[SRC_DIR_TOKENS[srcDir]] ?? srcDir;
    resolvedSrcDirs[srcDir] = dirname;
    const managed = path.join(out, dirname);

    // `isTruthy`, not `priorName &&`: the marker is user-editable JSON, and Python's
    // `if prior_name` is false for `[]`, `{}` and `0` where JS's is true for the first
    // two. Getting that wrong warns about a value Python skips in silence — a stderr
    // divergence reachable only from a hand-edited file, which is the one place nobody
    // would look for it.
    const priorName = priorSrcDirs[srcDir];
    if (isBundle && isTruthy(priorName) && priorName !== dirname) {
      if (safePriorDirName(out, priorName)) {
        const stale = path.join(out, priorName);
        if (isDir(stale)) rmSync(stale, { recursive: true, force: true });
      } else {
        process.stderr.write('[geneseed] WARN: ignoring suspicious prior dir name '
          + `${formatReprAscii(priorName)} recorded in ${SRC_DIRS_MARKER} - not pruned.\n`);
      }
    }

    if (!isDir(managed)) continue;
    if (isBundle) {
      rmSync(managed, { recursive: true, force: true });
    } else {
      // STDOUT, and ASCII-only: this print crashed with UnicodeEncodeError on a cp1252
      // Windows console when it carried a warning-sign emoji.
      process.stdout.write(`[geneseed] WARN: ${managed} already exists and ${out} is not a `
        + 'Geneseed bundle — keeping it; rendered files merge into it.\n');
    }
  }

  const nbDirname = theme[SRC_DIR_TOKENS.notebook] ?? 'notebook';
  for (const { rel, text, src } of items) {
    const dest = path.join(out, rel);
    mkdirSync(path.dirname(dest), { recursive: true });
    // The notebook is the agent's sovereign space: seeded files are written once and
    // never re-emitted, so the agent may rewrite its own rules. Only `.gitignore` is
    // re-asserted — the one law it cannot lift.
    const parts = rel.split('/');
    if (parts[0] === nbDirname && path.basename(rel) !== '.gitignore' && existsSync(dest)) {
      continue;
    }
    if (text !== null) writeText(dest, text);
    else copyFile(src, dest);
  }

  writeText(path.join(out, '.geneseed-theme'), `${themeName}\n`);
  writeVersion(cfg, out);
  writeSrcDirsMarker(out, resolvedSrcDirs);
  ensureContextStub(out);
  ensureWikiStub(out);
  ensureRulesStub(out);
  ensureProfileStub(out);
  ensureBundleGitignore(out);
  ensureMemoryIndex(path.join(out, theme[SRC_DIR_TOKENS.memory] ?? 'memory'));
  ensureNotebookIndex(path.join(out, theme[SRC_DIR_TOKENS.notebook] ?? 'notebook'));
  process.stdout.write(`[geneseed] built theme '${themeName}' -> ${out} (${items.length} files)\n`);
}

