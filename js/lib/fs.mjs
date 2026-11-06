/**
 * Reading and writing — files on disk, and the two process streams.
 *
 * These are definitions, not an adaptation of somebody else's. What holds the rules is
 * `tests/unit/lib_primitives.test.mjs` (`isFile`/`isDir`),
 * `tests/unit/hook_cli.test.mjs`'s platform-newline count (the stream funnels), and for the
 * rest only the per-function notes below. A rule here is a frozen fact about what this tool
 * emits, and changing one is a product change.
 *
 * ⚠ NONE OF THESE IS THE NODE DEFAULT, AND THAT IS THE ONE THING TO KNOW BEFORE EDITING ONE.
 * Each is a deliberate divergence from the obvious one-liner, and the obvious one-liner is
 * wrong here in a way no test in this repository would tell you about pleasantly. The
 * per-function comment says what the rule is and why it has that shape; it is the first thing
 * to read before touching one.
 *
 * In this module the divergence is `os.linesep`: every write translates `\n` to the platform's
 * separator, and `printOut`/`printErr` do the same on the way to the console.
 *
 * The rest of the old single `fs.mjs` lives beside this file: `json.mjs` (quoting and the
 * parsed-value model), `paths.mjs` (comparing and locating), `text.mjs` (string primitives).
 *
 * Everything here is stdlib-only, ESM, and deliberately tiny — it is imported on hook paths,
 * where load time is a per-tool-call cost.
 */
import {
  appendFileSync, writeFileSync, readFileSync, copyFileSync, statSync, utimesSync,
  openSync, fstatSync, readSync, closeSync, renameSync,
} from 'node:fs';
import { EOL } from 'node:os';
import { resolve } from 'node:path';

/**
 * What `writeText` wrote while an emit has armed this (`withWriteRecord` below, around the
 * three manifest-writing emits in `js/build/driver.mjs`): resolved path ->
 * `{ text, size, mtimeMs }`, the translated text and a stat taken right after the write.
 * `ownedHashes` (`js/hosts/owned.mjs`) hashes that text instead of reading the file back —
 * the read-back was ~25% of `doctor --all` — and only while the file's size and mtime still
 * match, so a later rewrite by any writer that does not record (a raw `writeFileSync`, a
 * rename) falls back to the read. `copyFile` and `appendText` drop the entry outright.
 * `null`, the default, records nothing: no other caller pays the stat or retains the text.
 */
export const textWrites = { map: null };

/**
 * Run one emit with `textWrites` armed, and disarm it on EVERY exit: an emit that throws inside
 * a long-lived process (the web daemon emits in-process) would otherwise leave every later
 * `writeText` paying a stat and keeping its text in memory.
 */
export function withWriteRecord(fn) {
  textWrites.map = new Map();
  try { return fn(); } finally { textWrites.map = null; }
}
/**
 * `Path.write_text(text, encoding="utf-8")`.
 *
 * Text mode: every `\n` is translated to `os.linesep` on the way out — a freshly emitted
 * AGENT.md is 504 CRLF and 0 bare LF on Windows. `fs.writeFileSync` translates nothing, so
 * without this wrapper *every* text file the tool emits would be LF on Windows.
 *
 * Two categories must NOT go through here, and they are the reason this is a named
 * function rather than a blanket rule:
 *   - the hook shim, which is written raw;
 *   - anything copied with `copyFile` (the OpenCode `plugins/*.js` and the
 *     vendored skill folders), which is a byte copy and keeps its LF.
 * The same vendored skill folder can contain files from both categories.
 */
export function writeText(path, text) {
  const out = EOL === '\n' ? text : text.replaceAll('\n', EOL);
  writeFileSync(path, out, 'utf8');
  if (textWrites.map) {
    const st = statSync(path);
    textWrites.map.set(resolve(path), { text: out, size: st.size, mtimeMs: st.mtimeMs });
  }
}

/**
 * `writeText` through a temp file and a rename, for a file two processes may rewrite at once (the
 * memory index, which two hosts can rebuild together). A reader sees the old file or the new one,
 * never half of one. A crash leaves a `.tmp` beside it, which no `*.md` glob lists and the next
 * write by the same pid overwrites.
 */
export function writeTextAtomic(path, text) {
  const tmp = `${path}.${process.pid}.tmp`;
  writeText(tmp, text);
  renameSync(tmp, path);
}

/**
 * `path.open("a", encoding="utf-8").write(text)` — the APPEND half of the rule above.
 *
 * Same translation, second mode. It lives here rather than inlined at its one call site
 * (`js/maintain/update.mjs`'s install log) because the newline rule has exactly one owner in this
 * port and a second copy of it is how the rule rots: an appended line written with
 * `appendFileSync` alone is the only LF-terminated line in an otherwise CRLF file, which is
 * invisible in an editor and a whole-file difference to the gate.
 */
export function appendText(path, text) {
  textWrites.map?.delete(resolve(path));
  appendFileSync(path, EOL === '\n' ? text : text.replaceAll('\n', EOL), 'utf8');
}

/**
 * `Path.read_text(encoding="utf-8")`.
 *
 * Text files are decoded in universal-newlines mode: `\r\n` and a lone `\r` both
 * become `\n` before any regex ever sees them. Node hands back the bytes as-is. The
 * repo's `.gitattributes` normalises `src/` to LF so today this is a no-op, but a
 * checkout with `core.autocrlf=true`, a copied tree, or an editor that rewrote one file
 * would otherwise change what `^...$` and `splitlines()` match — a divergence that shows
 * up as mangled output in one theme and nowhere else.
 */
export function readText(path) {
  return readFileSync(path, 'utf8').replaceAll('\r\n', '\n').replaceAll('\r', '\n');
}

/**
 * The last `bytes` of a file, decoded as `readText` decodes it, and the byte offset the window
 * began at (0: the whole file). A window that starts mid-line drops that partial line, cut at a
 * newline BYTE before decoding — so a multibyte character the window split falls in the dropped
 * part, and a `\r\n` split between its two bytes leaves only an empty line. One byte before the
 * window is read too, so a window that starts exactly on a line keeps it. Throws as
 * `readFileSync` does (missing, unreadable, a directory).
 */
export function readTail(path, bytes) {
  const fd = openSync(path, 'r');
  try {
    const st = fstatSync(fd);
    // Windows opens a directory without complaint and reports size 0: refuse it as readFileSync does.
    if (st.isDirectory()) {
      throw Object.assign(new Error(`EISDIR: illegal operation on a directory, read '${path}'`),
        { code: 'EISDIR' });
    }
    const size = st.size;
    const start = Math.max(0, size - bytes);
    const from = start > 0 ? start - 1 : 0;
    const buf = Buffer.alloc(size - from);
    let got = 0;
    while (got < buf.length) {
      const n = readSync(fd, buf, got, buf.length - got, from + got);
      if (!n) break;
      got += n;
    }
    let cut = 0;
    if (start > 0) {
      const read = buf.subarray(0, got);
      const ends = [read.indexOf(0x0a), read.indexOf(0x0d)].filter((i) => i !== -1);
      cut = ends.length ? Math.min(...ends) + 1 : got;   // no line end: nothing whole to decode
    }
    const text = buf.toString('utf8', cut, got).replaceAll('\r\n', '\n').replaceAll('\r', '\n');
    return { text, start };
  } finally {
    closeSync(fd);
  }
}

/**
 * `shutil.copy2(src, dest)`.
 *
 * A byte copy, so the file keeps its own line endings — this is the OTHER half of the
 * `writeText` rule above, and the reason both exist as named functions: the vendored
 * skill folders contain files taken by each route, and picking the wrong one is a silent
 * whole-file diff. `copy2` also carries the source's mtime across, which `copyFileSync`
 * alone does not.
 *
 * Deliberate deviation: `copy2` copies the permission bits too (`copymode`), which on
 * Windows means the read-only attribute. Reproducing that would make a second emit fail
 * to overwrite its own output if a source file were ever marked read-only — a failure
 * mode and nothing depends on it. Mode is not copied here.
 */
export function copyFile(src, dest) {
  textWrites.map?.delete(resolve(dest));
  copyFileSync(src, dest);
  const st = statSync(src);
  utimesSync(dest, st.atime, st.mtime);
}

/**
 * The two output funnels, with text-mode newline translation.
 *
 * The STREAM twin of `writeText` above, and it lives beside it because it is the same rule:
 * on Windows every `\n` a CLI prints leaves the process as `\r\n`. `process.stdout`
 * translates nothing, so without this a Node CLI would hand its caller different BYTES: 171
 * where 176 are expected for one `context` run.
 *
 * The CLI matrix structurally cannot see the difference — every cell decodes stdout with
 * universal newlines, folding both shapes to `\n` before anything compares them. So the gate
 * for it is `tests/unit/hook_cli.test.mjs`'s `every newline the entry points write is the
 * platform's`, which counts raw bytes. It lives here, not in `js/hosts/hooks.mjs`,
 * because `js/inspect/excludes.mjs` is a second caller: a translation
 * that exists twice is a translation that can be fixed once.
 */
const xlate = (s) => (EOL === '\n' ? s : s.replaceAll('\n', EOL));
export const printOut = (s) => process.stdout.write(xlate(s));
export const printErr = (s) => process.stderr.write(xlate(s));

/**
 * Hold `fn`'s stderr, and emit it only if `fn` RETURNS.
 *
 * For code that writes its refusal at the raise site (`js/build/generate.mjs`'s `sysExit`
 * docblock states the convention). That is right for every caller that lets the throw
 * propagate, and wrong for every caller that catches: the message is already out.
 *
 * It lives beside `printErr`, whose writes it intercepts. `js/hosts/hosts.mjs`'s
 * `expanduser` refuses a `~user` path by
 * printing and throwing, and `js/hosts/hooks.mjs` catches it twice — once per `excludes.json`
 * entry and once around `$GENESEED_ROOT`/`--root`. Its old docblock in `js/inspect/doctor.mjs`
 * warned that a general helper "would invite a second caller that wanted silence the
 * noise". That warning stands and is the contract: this is for a message that belonged to
 * an exception NOBODY LET ESCAPE, never for quieting output a call legitimately makes —
 * which is why the held chunks are replayed in full on the success path.
 */
export function withDiscardableStderr(fn) {
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

/**
 * The same rule applied to a whole CALL rather than to one string — `bin/build-driver.mjs`'s
 * answer to newlines it cannot gate cell by cell.
 *
 * WHY THE DRIVER NEEDS A FUNNEL WHERE EVERY OTHER CALLER NEEDS `printOut`. The generator
 * prints from ~25 sites across `bin/build-driver.mjs`, `js/build/bundle.mjs`, `js/hosts/settings.mjs`,
 * `js/hosts/opencode.mjs`, `js/hosts/native.mjs` and `js/build/render.mjs`. Converting those
 * sites to `printOut` would translate once per layer that re-prints the output, and a second
 * translation turns `\r\n` into `\r\r\n` on every line. So the translation belongs to
 * whichever process OWNS the stream.
 * This wraps the driver's `main`, and equally the four render entry points the CLI can reach
 * WITHOUT `main` on the stack: `parseDriverArgs`, `buildInto`, `emitProjectInto` and
 * `emitGlobalInto`.
 *
 * What it closes: a plain `--emit files` handed its caller 104 bytes where 105 are expected,
 * and a text-mode capture folds both to the same string.
 * `tests/unit/hook_cli.test.mjs`'s newline test carries a `build` row (through `geneseed
 * build`, which calls this `main` in-process), and that is what can see it.
 *
 * A Buffer chunk passes through untouched: `writeText` owns file bytes and nothing on this
 * path writes binary to a stream, so translating one would be corrupting data.
 */
export function withPlatformNewlines(fn) {
  if (EOL === '\n') return fn();
  const outW = process.stdout.write.bind(process.stdout);
  const errW = process.stderr.write.bind(process.stderr);
  const wrap = (real) => (chunk, ...rest) => real(
    typeof chunk === 'string' ? xlate(chunk) : chunk, ...rest,
  );
  process.stdout.write = wrap(outW);
  process.stderr.write = wrap(errW);
  try {
    return fn();
  } finally {
    process.stdout.write = outW;
    process.stderr.write = errW;
  }
}

/**
 * `Path.is_file()` / `Path.is_dir()` — false for a missing path, never a throw.
 *
 * SINGLE OWNER. Six modules (`js/inspect/scan.mjs` plus five more under `hosts/`, `inspect/`,
 * `build/`, `web/` and `bin/`) each carried a private `(p) => { try {...} catch { return
 * false; } }` copy of one or both; this is now the one definition, and `scan.mjs` re-exports
 * it for its own existing callers rather than owning a copy itself. `js/hosts/hooks.mjs` is
 * the deliberate exception — the hot path keeps its own inline copy rather than pay an import.
 *
 * WHICH ERRORS MEAN "NO", matching `pathlib`'s `_ignore_error`: `ENOENT` (nothing there),
 * `ENOTDIR` (a path THROUGH a file — `skills/brainstorm.md/SKILL.md`), `ELOOP`, `EBADF`. Each is a
 * definite answer that nothing of that kind is at the path. Anything else — a permission
 * failure above all — still throws: read as "not there" it would be the wrong answer, silently.
 * Every copy this replaced used a bare `try/catch` that swallowed everything alike.
 *
 * ⚠ `ENOTDIR` WAS ONCE LEFT TO THROW here, on the reading that it resembled an access error.
 * It is not one, and Windows reports the same probe as `ENOENT` — so the difference only shows
 * on macOS/Linux: the folder-skill count asked `isFile(<skills>/<flat>.md/SKILL.md)` and the
 * web console's overview died with `ENOTDIR` there while every Windows run stayed green.
 */
const NOT_THERE = new Set(['ENOENT', 'ENOTDIR', 'ELOOP', 'EBADF']);

export function statOrNull(p) {
  try {
    return statSync(p);
  } catch (e) {
    if (e && NOT_THERE.has(e.code)) return null;
    throw e;
  }
}

export function isFile(p) {
  return statOrNull(p)?.isFile() ?? false;
}

export function isDir(p) {
  return statOrNull(p)?.isDirectory() ?? false;
}

/**
 * `except OSError` — an fs failure carries a `code`; anything else is a bug, so rethrow.
 *
 * SINGLE OWNER of a one-line predicate `js/hosts/settings.mjs`, `js/maintain/uninstall.mjs`
 * and `js/inspect/excludes.mjs` each declared privately, byte-identically.
 */
export function isOsError(e) {
  return Boolean(e) && typeof e.code === 'string';
}

