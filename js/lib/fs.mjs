/**
 * Reading and writing — files on disk, and the two process streams.
 *
 * These are definitions, not an adaptation of somebody else's. Every rule below was
 * originally MEASURED against CPython, because the generator these functions serve had to
 * emit bytes indistinguishable from a Python one; that second party is gone and the rules
 * are not. What holds them now is the recorded corpora under `tests/__snapshots__/`, which
 * compare this module's output byte for byte and can never be re-recorded — so a rule here
 * is a frozen fact about what this tool emits, and changing one is a product change.
 *
 * ⚠ NONE OF THESE IS THE NODE DEFAULT, AND THAT IS THE ONE THING TO KNOW BEFORE EDITING ONE.
 * Each is a deliberate divergence from the obvious one-liner, and the obvious one-liner is
 * wrong here in a way no test in this repository would tell you about pleasantly. These names
 * carried a `py` prefix until the prefix was retired, precisely to say so; the warning now
 * lives where it belongs, in the per-function comment naming WHAT WAS MEASURED and against
 * what. That provenance is the only surviving record of why a rule has the shape it has, and
 * it is the first thing to read before touching one.
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
} from 'node:fs';
import { EOL } from 'node:os';
/**
 * `Path.write_text(text, encoding="utf-8")`.
 *
 * Python opens that file in TEXT mode with `newline=None`, so every `\n` is translated
 * to `os.linesep` on the way out — a freshly emitted AGENT.md is 504 CRLF and 0 bare LF
 * on Windows. `fs.writeFileSync` translates nothing. Without this wrapper *every* text
 * file the port emits differs from Python's on Windows, and the byte-identity gate that
 * is the whole acceptance test of the port yields exactly zero signal: it reports 100%
 * failure whether the render is right or wrong.
 *
 * Two categories must NOT go through here, and they are the reason this is a named
 * function rather than a blanket rule:
 *   - the hook shim, which Python writes with `newline=""` (raw);
 *   - anything Python copies with `shutil.copy2` (the OpenCode `plugins/*.js` and the
 *     vendored skill folders), which is a byte copy and keeps its LF.
 * The same vendored skill folder can contain files from both categories.
 */
export function writeText(path, text) {
  writeFileSync(path, EOL === '\n' ? text : text.replaceAll('\n', EOL), 'utf8');
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
  appendFileSync(path, EOL === '\n' ? text : text.replaceAll('\n', EOL), 'utf8');
}

/**
 * `Path.read_text(encoding="utf-8")`.
 *
 * Python decodes text files in universal-newlines mode: `\r\n` and a lone `\r` both
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
 * mode the Python side has and nothing depends on. Mode is not copied here.
 */
export function copyFile(src, dest) {
  copyFileSync(src, dest);
  const st = statSync(src);
  utimesSync(dest, st.atime, st.mtime);
}

/**
 * `print()` — the two output funnels, with Python's newline translation reproduced.
 *
 * The STREAM twin of `writeText` above, and it lives beside it because it is the same rule:
 * `sys.stdout` is a TextIOWrapper with `newline=None`, so on Windows every `\n` a CLI prints
 * leaves the process as `\r\n` — and `harness.py`'s `reconfigure(encoding="utf-8")` changes
 * the encoding only, not that. `process.stdout` translates nothing, so a Node CLI would hand
 * its caller different BYTES than the Python one: measured at 176 vs 171 for one `context`
 * run before this existed.
 *
 * `harness_golden.py` structurally cannot see the difference — `subprocess` decodes with
 * universal newlines on the way back, folding both shapes to `\n` before any cell compares
 * them, the same shape as the shim's exclusion from `golden.py`. So the gate for it is
 * `test_the_two_entry_points_agree_on_stdout_BYTES`, which captures raw bytes. Moved here
 * from `js/hosts/hooks.mjs` in P5c, when `js/inspect/excludes.mjs` became the second caller: a translation
 * that exists twice is a translation that can be fixed once.
 */
const xlate = (s) => (EOL === '\n' ? s : s.replaceAll('\n', EOL));
export const printOut = (s) => process.stdout.write(xlate(s));
export const printErr = (s) => process.stderr.write(xlate(s));

/**
 * Hold `fn`'s stderr, and emit it only if `fn` RETURNS.
 *
 * The reproduction of `except SystemExit` for a port that writes its refusal at the raise
 * site (`js/build/generate.mjs`'s `sysExit` docblock states the convention). `sys.exit(msg)`
 * attaches the message to the EXCEPTION and the interpreter prints it on the way out, so a
 * Python caller that catches sees no output at all — which makes write-at-the-raise-site
 * identical for every caller that lets the throw propagate, and wrong for every caller that
 * catches.
 *
 * MOVED HERE beside `printErr`, whose writes it intercepts, when the hook became the
 * second and third such caller: `js/hosts/hosts.mjs`'s `expanduser` refuses a `~user` path by
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
 * answer to the newline item P5e recorded and could not gate.
 *
 * WHY THE DRIVER NEEDS A FUNNEL WHERE EVERY OTHER CALLER NEEDS `printOut`. The generator
 * prints from ~25 sites across `bin/build-driver.mjs`, `js/build/bundle.mjs`, `js/hosts/settings.mjs`,
 * `js/hosts/opencode.mjs`, `js/hosts/native.mjs` and `js/build/render.mjs`, and those modules are ALSO the
 * body of what used to be a seam child, whose `main` buffered both streams and handed them
 * to a Python parent that re-printed them through `print()`. Converting those sites to
 * `printOut` would have translated once in Node and again in Python — `\r\r\n` on every line.
 * So the translation belongs to whichever process OWNS the stream, and that child did not.
 * This wraps the driver's `main`, and equally the four render entry points the CLI can reach
 * WITHOUT `main` on the stack: `parseDriverArgs`, `buildInto`, `emitProjectInto` and
 * `emitGlobalInto`.
 *
 * The item it closes: a plain `--emit files` handed its caller 104 bytes where `python
 * build.py` handed over 105, and `tests/golden.py`'s `text=True` capture folds both to the
 * same string. `test_the_two_entry_points_agree_on_stdout_BYTES` grew a `build` row (through
 * `harness build`, which calls this `main` in-process) and a `rebuild-all` row, and those are
 * what can see it.
 *
 * A Buffer chunk passes through untouched: `writeText` owns file bytes and nothing on this
 * path writes binary to a stream, so translating one would be corrupting data rather than
 * reproducing Python.
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

