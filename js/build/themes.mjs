/**
 * `_build_render.sync_themes` / `_insert_theme_keys` — the generator's `--sync-themes`, the
 * maintainer tool that fills every shipped theme with the keys `_TEMPLATE.json` defines.
 *
 * IT IS A BYTE-EXACT TEXTUAL EDIT OF COMMITTED FILES, which is what makes it the most
 * dangerous thing in this phase and why it has its own corpus before it has a port. Every
 * other tool this port has crossed WRITES A TREE it also renders; this one reaches into
 * fourteen files a human wrote, inserts a line into each, and leaves the other ~170 lines
 * untouched. A port that got the insertion right and the newline translation wrong would
 * rewrite every line of every theme on the first maintainer run, and `git diff` — not a
 * gate — is where that would be discovered.
 *
 * NEITHER `--sync-themes` NOR `--validate-only` IS REACHABLE FROM ANY CELL. `golden.py`'s
 * `_argv` emits neither flag (argued in situ at `bin/build-driver.mjs`'s dispatch), so the
 * acceptance matrix that gates all nine emits is structurally blind to both, and the driver
 * refused them rather than crossing for exactly that reason. The gate is
 * `tests/unit/maintainer_tools.test.mjs`, replaying the frozen recording in
 * `tests/__snapshots__/sync_themes.json`: a corpus of hand-made theme directories, comparing
 * the printed output, the return value and the resulting FILE BYTES against what the reference
 * answered. Nothing can re-record it, so a change here that moves a byte is a product change.
 *
 * WHY THIS MODULE IS NOT `js/inspect/doctor.mjs`. `--sync-themes` has no doctor dependency, so it
 * stays on the generator driver where its flag lives — and the driver is under a transitive
 * ban on starting processes, which this module's imports respect. Its sibling
 * `--validate-only` needs the doctor and therefore could not stay; see `cmdValidate`.
 *
 * THE PRIMITIVES ARE BORROWED, NOT REWRITTEN. `splitLines`, `stripWhitespace`/`stripWhitespaceStart`/
 * `stripWhitespaceEnd`, `parseJson`, `deepEquals`, `jsonDumpsCompact`, `jsonDumpsIndent`, `readText` and
 * `writeText` all already exist and are all already gated. This file's documented failure
 * mode is the same primitive existing twice under two names and the two disagreeing, and
 * `str.strip` and `json.dumps` are precisely the two that would have been re-derived here.
 */
import path from 'node:path';

import { THEMES } from './source.mjs';
import { themeFiles } from '../hosts/installs.mjs';
import { splitLines } from '../lib/udiff.mjs';
import { readText, writeText } from '../lib/fs.mjs';
import { jsonDumpsCompact, jsonDumpsIndent, parseJson, deepEquals } from '../lib/json.mjs';
import { stripWhitespaceStart, stripWhitespaceEnd, stripWhitespace } from '../lib/text.mjs';

/**
 * `_build_render._insert_theme_keys` — insert ONLY the missing keys into the theme's existing
 * TEXT, each as one new line at its template-order position.
 *
 * A full `json.dumps` round-trip cannot reproduce the shipped files byte-for-byte (they mix
 * raw Unicode with legacy `\\uXXXX` escapes), so re-dumping made a one-key sync a ~170-line
 * rewrite per theme. Textual insertion keeps the diff to the inserted line plus at most a
 * comma on its predecessor.
 *
 * Returns `null` when the file does not follow the shipped convention (`{` alone on line 1,
 * one `  "KEY": value` per line) or when the result fails the reparse safety check — the
 * caller then falls back to a full re-dump.
 *
 * FOUR PRIMITIVES CARRY THE WHOLE THING, and each is a place the two languages differ:
 *   - `splitLines` is `str.splitlines()`, which breaks on U+2028/U+2029 where `split('\\n')`
 *     does not — a theme file that acquired one from a paste would be re-lined by Python and
 *     not by a naive port, and the insertion index would then point at a different key;
 *   - the three `strip` spellings are Python's whitespace set, not `String.prototype.trim`'s;
 *   - `jsonDumpsCompact(v, {ensureAscii: false})` is `json.dumps(v, ensure_ascii=False)`,
 *     including the `', '`/`': '` separators — which matter for exactly ONE key,
 *     `AGENT_COLORS`, the only non-string among `_TEMPLATE.json`'s 140 values. `ensureAscii`
 *     is false because the reference passes `ensure_ascii=False`, and 33 template values
 *     carry non-ASCII text that would otherwise be escaped into the committed file;
 *   - `deepEquals`, because the safety net compares two `json.loads` results and `===` is identity
 *     for containers — a `===` here would return `null` every time and silently route every
 *     theme through the re-dump fallback, i.e. rewrite all 14 files in full.
 */
export function insertThemeKeys(raw, theme, tmpl, tmplKeys, missing) {
  const lines = splitLines(raw);
  if (!lines.length || stripWhitespace(lines[0]) !== '{') return null;

  const lineOf = (key) => {
    // `f'  "{key}":'` — raw interpolation, NOT a JSON-escaped key. A theme key carrying a
    // quote would not match on either side, which is the same answer both give.
    const prefix = `  "${key}":`;
    for (let i = 0; i < lines.length; i += 1) if (lines[i].startsWith(prefix)) return i;
    return null;
  };

  // Every existing key must be locatable as its own line, or the format assumption is wrong
  // and inserting would corrupt the file.
  for (const k of Object.keys(theme)) if (lineOf(k) === null) return null;

  for (const k of missing) { // template order, so an earlier insert can anchor a later one
    const entry = `  "${k}": ${jsonDumpsCompact(tmpl[k], { ensureAscii: false })}`;
    let pred = null;
    const earlier = tmplKeys.slice(0, tmplKeys.indexOf(k));
    for (let i = earlier.length - 1; i >= 0; i -= 1) {
      const li = lineOf(earlier[i]);
      if (li !== null) { pred = li; break; }
    }
    if (pred === null) {
      // No earlier template key exists in this theme: insert right after `{`.
      const follows = lines.slice(1).some((ln) => stripWhitespaceStart(ln).startsWith('"'));
      lines.splice(1, 0, entry + (follows ? ',' : ''));
    } else if (stripWhitespaceEnd(lines[pred]).endsWith(',')) {
      lines.splice(pred + 1, 0, `${entry},`);
    } else {
      // Predecessor was the last entry: it gains the comma, the new line is last.
      lines[pred] += ',';
      lines.splice(pred + 1, 0, entry);
    }
  }

  const newText = `${lines.join('\n')}\n`;
  // Safety net: the surgically-edited text must parse back to exactly the merge we meant.
  let reparsed;
  try { reparsed = parseJson(newText); } catch { return null; }
  const want = { ...theme };
  for (const k of missing) want[k] = tmpl[k];
  return deepEquals(reparsed, want) ? newText : null;
}

/**
 * `_build_render.sync_themes` — fill every shipped theme with the template's keys.
 *
 * Returns the number of themes actually modified (0 == already in sync); the driver maps that
 * to the exit code, so CI can run the tool as a drift check.
 *
 * `themesDir` is a parameter for the corpus, whose whole subject is what this writes; the
 * default is the checkout's own `themes/`, which is what the driver passes.
 *
 * PRINTS THROUGH A BARE `process.stdout.write`, like the generator's other ~25 print sites and
 * unlike every CLI verb: `bin/build-driver.mjs`'s `main` wraps the whole run in `withPlatformNewlines`,
 * so a `printOut` here would translate a second time and put `\r\r\n` on every line.
 *
 * ONE DELIBERATE DIVERGENCE FROM THE REFERENCE, changed on BOTH sides in this commit: a
 * missing or unreadable `_TEMPLATE.json` used to print and `return 0`, which the CLI maps to
 * exit 0 — "already in sync". That is a false green in the one job the tool exists for, and
 * the input that produces it is the one that makes the whole run vacuous. It now refuses with
 * exit 2. Dropping the interpolated exception text is the second half of the same change and
 * is what makes the branch gateable at all: `json.JSONDecodeError` and V8's parse error
 * disagree on both wording and offset, so a message carrying `{e}` can never be compared
 * across the two implementations. The PER-THEME unreadable message below keeps its `{e}` and
 * therefore keeps that divergence, matching the convention `js/inspect/doctor.mjs` already ships at
 * six sites — a skipped theme is a warning, not the tool's verdict.
 */
export function syncThemes(themesDir = THEMES) {
  const tmplPath = path.join(themesDir, '_TEMPLATE.json');
  let tmpl;
  try {
    tmpl = parseJson(readText(tmplPath));
  } catch {
    process.stdout.write(`[sync-themes] ${path.basename(tmplPath)} is missing or unreadable `
      + '— there is nothing to sync against.\n');
    const e = new Error('template unreadable');
    e.exitCode = 2;
    throw e;
  }
  const tmplKeys = Object.keys(tmpl);
  let changed = 0;
  for (const p of themeFiles(themesDir)) {
    const name = path.basename(p);
    let raw;
    let theme;
    try {
      raw = readText(p);
      theme = parseJson(raw);
    } catch (e) {
      process.stdout.write(`[sync-themes] ${name}: unreadable (${e.message}) — skipped\n`);
      continue;
    }
    // `Object.hasOwn`, never `k in theme`: a theme defining a `constructor` or `toString`
    // voice token would otherwise be reported as already carrying every key it lacks.
    const missing = tmplKeys.filter((k) => !Object.hasOwn(theme, k));
    const extra = Object.keys(theme).filter((k) => !Object.hasOwn(tmpl, k)).sort();
    if (!missing.length) {
      if (extra.length) {
        process.stdout.write(`[sync-themes] ${name}: in sync (extra key(s) not in template, `
          + `not removed: ${extra.join(', ')})\n`);
      }
      continue;
    }
    let newText = insertThemeKeys(raw, theme, tmpl, tmplKeys, missing);
    if (newText === null) {
      // Unconventional formatting: fall back to a full re-dump — template order, theme-only
      // extras preserved at the end, real Unicode kept as-is.
      const merged = {};
      for (const k of tmplKeys) merged[k] = Object.hasOwn(theme, k) ? theme[k] : tmpl[k];
      for (const k of Object.keys(theme)) if (!Object.hasOwn(merged, k)) merged[k] = theme[k];
      newText = `${jsonDumpsIndent(merged, { ensureAscii: false })}\n`;
    }
    writeText(p, newText);
    changed += 1;
    process.stdout.write(`[sync-themes] ${name}: added ${missing.length} key(s) from the `
      + `template — RESTYLE these in this theme's voice: ${missing.join(', ')}\n`);
    if (extra.length) {
      process.stdout.write(`[sync-themes] ${name}: extra key(s) not in template, not removed: `
        + `${extra.join(', ')}\n`);
    }
  }
  if (!changed) process.stdout.write('[sync-themes] all themes already carry every template key.\n');
  return changed;
}
