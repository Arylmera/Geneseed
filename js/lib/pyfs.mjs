/**
 * Python-compatible filesystem primitives.
 *
 * The Node port has to produce bytes identical to the Python generator's, and the two
 * runtimes disagree by default in ways that are invisible in a diff viewer. This module
 * is where those disagreements are settled, once, so no caller has to remember them.
 *
 * Everything here is stdlib-only, ESM, and deliberately tiny — it is imported by hook
 * paths eventually, where load time is a per-tool-call cost.
 */
import { writeFileSync, readFileSync } from 'node:fs';
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

// ponytail: no `jsonDumps` yet. Python's `json.dumps` escapes non-ASCII by default and
// `JSON.stringify` does not (44 emitted `description:` lines already carry an em dash),
// but nothing on the Node side writes JSON yet, so an unused escaping stringifier would
// be a guess about its own signature. It lands with the first Node JSON writer, together
// with the raw variant the two `ensure_ascii=False` call sites need.
