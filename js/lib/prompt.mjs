/**
 * The line-mode stdin readers — `ask`, `promptLine`, `confirm`, `askChoice` over one `readLine`.
 *
 * MOVED OUT OF `js/maintain/setup.mjs`, which is where the Python's own owner (`_harness_setup`)
 * put them, because two callers that are not the wizard need them: `uninstall`'s `confirm` and
 * the web server's npm prompt. Importing them from `setup.mjs` dragged the whole wizard closure
 * — the driver, the doctor, the diff exporter — into `uninstall` and `web` for four functions
 * whose only dependencies are fd 0, `printOut` and `parseIntStrict`.
 */
import { readSync } from 'node:fs';

import { printOut } from './fs.mjs';
import { parseIntStrict } from './text.mjs';

/**
 * `_harness_setup._ask` — `input(f"{prompt}{suffix}: ").strip()`, or the default at EOF.
 *
 * WHY IT READS A BYTE AT A TIME. Node has no synchronous line read: `readFileSync(0)` blocks
 * until EOF rather than until Enter, so a wizard built on it would hang on a real terminal
 * until the user pressed Ctrl-D. Reading fd 0 one byte at a time to the first `\n` is what
 * `input()` does, and it is the only synchronous shape that stops where Enter stops. The
 * body arrived in P5h inside `js/maintain/uninstall.mjs`'s `confirm`, moved to `setup` when that
 * became the second caller, and lives here now that the callers outnumber the wizard;
 * `confirm` is built on it exactly as `_confirm` is built on `_ask` in the Python.
 *
 * The EOF branch is the one a piped caller sees, and it agrees with Python by two different
 * routes that happen to produce one answer: `input()` RAISES `EOFError` and the `except`
 * returns the default, while a zero-length read here leaves `line` empty and `|| dflt` does
 * the same. A partial line with no trailing newline is not EOF to either — Python returns
 * the characters and so does this.
 *
 * `.trim()` is `str.strip()` in every case but U+FEFF, which JS counts as whitespace and
 * Python does not; that is a standing item of this port and not this function's to settle.
 */
export function ask(prompt, dflt = '') {
  const suffix = dflt ? ` [${dflt}]` : '';
  // `input()` writes its prompt to stdout with no newline — nothing for `printOut` to
  // translate, and it must NOT gain one.
  process.stdout.write(`${prompt}${suffix}: `);
  // `?? ''` because `readLine` reports EOF-with-nothing-read as null since P6h; `_ask`
  // catches `EOFError` and returns the default, which is what the empty string produces
  // here through `|| dflt`. The two routes to one answer are the docblock's own point.
  const ans = (readLine() ?? '').trim();
  return ans || dflt;
}

/**
 * `input(prompt)` with EOF told apart from an empty line — `null` where Python RAISES.
 *
 * `ask` above cannot express that difference and does not need to: its EOF and its empty
 * answer both mean "take the default". `_web_server.serve`'s npm prompt is the first
 * caller where they differ, and they differ dangerously — `""` is in its accepted set, so
 * a port that read EOF as an empty line would answer YES to "run npm install now?" on
 * every non-interactive run. The reference catches `(EOFError, KeyboardInterrupt)` and
 * answers "n"; this returns null so the caller can.
 *
 * No `.trim()`: `input()` does not strip, and both callers strip for themselves.
 */
export function promptLine(prompt) {
  process.stdout.write(prompt);
  return readLine();
}

/**
 * Fd 0 to the first `\n`, dropping a `\r` before it — the CRLF a Windows console sends.
 *
 * THE BYTES ARE COLLECTED AND DECODED ONCE, and that is a fix rather than a style. The
 * version this arrived as decoded EACH BYTE on its own — `buf.toString('utf8', 0, n)` inside
 * the loop — which turns every multi-byte character into two or three U+FFFD. It was
 * invisible for a phase because its only caller was `confirm`, whose answer is `y` or `n`;
 * the wizard's first non-ASCII answer is what exposed it, and the corpus caught it on the
 * first run. Scanning for the terminators a byte at a time is still correct: `\n` and `\r`
 * are ASCII, and no continuation byte of a UTF-8 sequence is below 0x80.
 */
function readLine() {
  const buf = Buffer.alloc(1);
  const bytes = [];
  let eof = false;
  for (;;) {
    let n = 0;
    try { n = readSync(0, buf, 0, 1, null); } catch { eof = true; break; }
    if (n === 0) { eof = true; break; }
    if (buf[0] === 0x0a) break;
    if (buf[0] !== 0x0d) bytes.push(buf[0]);
  }
  // NULL ONLY FOR THE EMPTY EOF, which is the one case `input()` raises on. A partial line
  // with no trailing newline is not EOF to Python — it returns the characters — and the
  // `bytes.length` test is what keeps that arm returning a string here too.
  if (eof && bytes.length === 0) return null;
  return Buffer.from(bytes).toString('utf8');
}

/** `_harness_setup._confirm` — `_ask` with a Y/n suffix; the default on an empty answer. */
export function confirm(prompt, dflt = true) {
  const ans = ask(`${prompt} (${dflt ? 'Y/n' : 'y/N'})`).toLowerCase();
  return ans === '' ? dflt : ans[0] === 'y';
}

/**
 * `_harness_setup._ask_choice` — a numbered menu; the chosen KEY, or the default.
 *
 * THREE THINGS ABOUT THE FALLBACK ORDER, all of them observable and none of them obvious:
 *
 *   * The key match lives in Python's `except ValueError`, so an answer that PARSES as an
 *     integer never reaches it. `99` against a five-option menu returns the default; it does
 *     not go looking for an option literally named `99`.
 *   * An in-range index wins, a parsed out-of-range index falls to the default, and only an
 *     UNPARSEABLE answer is matched against the keys. `parseIntStrict` is what separates the second
 *     case from the third, and it is not `Number()` — see its own docblock.
 *   * A default that is NOT in `options` falls back to option 1. It is reachable — a deployed
 *     `.geneseed-theme` can name a theme this checkout no longer ships — and it used to throw,
 *     mirroring the Python reference's `StopIteration`, which crashed `geneseed setup` before
 *     its first question. The reference is gone, so there is nothing left to fail in step
 *     with, and returning a key that is not on the menu would hand the build a stale value.
 */
export function askChoice(prompt, options, dflt) {
  if (!options.some(([k]) => k === dflt)) dflt = options[0][0];
  printOut(`\n${prompt}:\n`);
  options.forEach(([key, desc], i) => {
    const label = desc ? `${key} — ${desc}` : key;
    printOut(`  ${i + 1}) ${label}${key === dflt ? '   (default)' : ''}\n`);
  });
  const defaultIdx = options.findIndex(([k]) => k === dflt);
  const raw = ask('Choose', String(defaultIdx + 1));
  const idx = parseIntStrict(raw);
  if (idx !== null) {
    if (idx >= 1 && idx <= options.length) return options[idx - 1][0];
  } else {
    for (const [key] of options) if (raw === key) return key;
  }
  return dflt;
}
