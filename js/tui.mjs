/**
 * `tui` — and the TUI's pure half, which is the part of the panel that has no curses in it.
 *
 * WHAT CROSSES HERE AND WHAT DOES NOT.
 *
 * `cmd_tui` (`rituals/_harness_tui.py`) is twenty-six lines and three arms. Off a TTY it
 * prints one line and returns 1; when `import curses` fails it prints one line and returns
 * 1; otherwise it builds the inventory and hands the screen to `curses.wrapper(_tui_loop)`.
 * **Every cell in `tests/harness_golden.py` runs off a TTY**, so the first arm is the whole
 * of `tui`'s behaviour that the acceptance matrix can reach, and it is ported byte for byte.
 *
 * THE PANEL ITSELF IS P7C'S, AND THIS ENTRY FALLS BACK RATHER THAN INVENTING ONE — the same
 * decision `js/menu.mjs` made in P7a, for the same reason. `cmd_tui` already owns a fourth
 * path: an `except Exception` around `curses.wrapper` that prints `[tui] full-screen panel
 * unavailable (<reason>)` and returns 1, written for the Windows shim's `Unsupported`. That
 * is the reference's own contract for "no full-screen panel is available here", so the port
 * speaks it with a reason that is permanent rather than machine-dependent. A Node panel that
 * differed from the reference on every screen, that no cell could reach, and that would be
 * deleted the day the real one crossed, would be a second user interface and not a port.
 *
 * WHAT DOES CROSS is the alignment contract — the functions below that decide what a row
 * looks like before any curses call is made. They have no caller in this file yet, and that
 * is deliberate and dated: **P7c is the due date**, when `_tui_loop` and the eighteen
 * screens of `_harness_tui_views.py` arrive and consume them. They are here now because they
 * are the half that can be gated exhaustively, and `tests/test_pure_function_parity.py`
 * gates every one of them in both glyph modes. Deleting any of them turns that gate red —
 * this port has shipped code before whose absence nothing would have noticed, and these are
 * not that.
 *
 * WHAT IS DELIBERATELY NOT HERE: `_bx` (its non-ASCII arm returns `curses.ACS_*` chtype ints,
 * which belong with the window), `_wrap_lines` (no consumer until the screens arrive, so
 * porting it now would be a reduced port with no caller to check it against), and every
 * `(stdscr, curses, pal)` drawing helper.
 *
 * **DO NOT WRITE A SECOND LINE BREAKER.** This block used to argue that `textwrap.wrap` was
 * "a second `difflib` — a stdlib payload with no Node twin". It has one since P1:
 * `pyTextWrap` in `js/cli.mjs`, written because `--help` was the caller that finally
 * required it, frozen at `tests/__snapshots__/textwrap.json` and swept against the running
 * interpreter at every width from 11 to 198. When P7c brings `_wrap_lines` across it wraps
 * THAT, and the only open question is the ASCII/glyph width the panel measures in. `_parse_laws`, `load_registry`, `entity_status` and
 * `_tui_inventory` crossed in P6c and live in `js/inventory.mjs`.
 */
import path from 'node:path';

import { THEMES } from './checkout.mjs';
import { readJsonMaybe } from './installs.mjs';
import { pySplitLines } from './lib/pydiff.mjs';
import { pyPrint } from './lib/pyfs.mjs';

// ---- display tiers -------------------------------------------------------------------
//
// The reference reads these into MODULE CONSTANTS at import time (`_TUI_ASCII = bool(
// os.environ.get(...))`), so a process answers one way for its whole life and the corpus
// runs one probe process per mode rather than monkeypatching. Read once here too, for the
// same reason. `bool(os.environ.get(x))` and `!!process.env.x` agree on the case that
// matters: an EMPTY value is not set.
const TUI_ASCII = !!process.env.GENESEED_TUI_ASCII;
const TUI_PLAIN = !!process.env.GENESEED_TUI_PLAIN;
const TUI_EMOJI = !(TUI_ASCII || TUI_PLAIN);
const TUI_ANIM = TUI_EMOJI;

/** `_glyphs` — the one glyph table for the whole TUI, unicode or ASCII stand-ins. */
export function glyphs(asciiMode) {
  return {
    sel: asciiMode ? '>' : '▸',
    up: asciiMode ? '^' : '▴',
    down: asciiMode ? 'v' : '▾',
    head: asciiMode ? '*' : '◆',
    skill: asciiMode ? '*' : '✦',
    law: asciiMode ? '#' : '§',
  };
}

export const GLYPH = glyphs(TUI_ASCII);

// ---- display width -------------------------------------------------------------------
//
// `_dwidth` is the one function in this phase with NO equivalent at any rung of the ladder.
// It calls `unicodedata.east_asian_width` and `unicodedata.combining`; JavaScript has
// neither. `RegExp` Unicode property escapes carry `\p{General_Category}` and `\p{Script}`
// but NOT `East_Asian_Width`, and `\p{Mn}|\p{Me}` is not the predicate `combining(ch) != 0`
// — measured, it disagrees on 897 codepoints across 229 ranges, because a spacing mark is
// `Mc` with combining class 0 and a great many `Mn` have class 0 too. So the tables below
// are the port's own, and no dependency was added to get them.
//
// A HAND-CARRIED UNICODE TABLE IS THE KIND OF THING THAT IS RIGHT UNTIL IT IS NOT, so the
// gate over it is not a case list. `tests/test_pure_function_parity.py` walks EVERY
// codepoint from U+0000 to U+2FFFF on both sides, run-length encodes the widths, and
// compares the run lists — 196 608 inputs, and a range this table gets wrong has nowhere to
// hide. The comparison is against Python's LIVE `unicodedata`, never against a copy of it,
// so the day the reference's Unicode version moves under these tables the gate says so
// instead of agreeing with itself.
//
// THE VERSION IS DECLARED, not left in a comment, and that changed on the day the gate fired
// for real. `python3.14` ships unidata 16.0.0, which assigned U+0897 a combining class these
// tables (built from 15.1.0) do not carry — so the sweep went red naming a codepoint, exactly
// as designed, on a machine whose only difference was the interpreter. That is not a defect
// in either implementation and it must not read as one: the sweep is a comparison against a
// SPECIFIC Unicode version, and a comparison is meaningless against a different one. So the
// version is a constant the test reads, `.github/workflows/ci.yml` pins the interpreter that
// supplies it, and `tests/test_pure_function_parity.py` asserts the pin and the constant
// still agree. Regenerating the tables means bumping all three together.
export const DWIDTH_UNIDATA = '15.1.0';

//: East_Asian_Width W or F, below U+1F000 — above it the reference's own `>= 0x1F000` rule
//: already answers 2, so the table stops where that rule takes over.
const WIDE = [
  0x1100, 0x115F, 0x231A, 0x231B, 0x2329, 0x232A, 0x23E9, 0x23EC, 0x23F0, 0x23F0,
  0x23F3, 0x23F3, 0x25FD, 0x25FE, 0x2614, 0x2615, 0x2648, 0x2653, 0x267F, 0x267F,
  0x2693, 0x2693, 0x26A1, 0x26A1, 0x26AA, 0x26AB, 0x26BD, 0x26BE, 0x26C4, 0x26C5,
  0x26CE, 0x26CE, 0x26D4, 0x26D4, 0x26EA, 0x26EA, 0x26F2, 0x26F3, 0x26F5, 0x26F5,
  0x26FA, 0x26FA, 0x26FD, 0x26FD, 0x2705, 0x2705, 0x270A, 0x270B, 0x2728, 0x2728,
  0x274C, 0x274C, 0x274E, 0x274E, 0x2753, 0x2755, 0x2757, 0x2757, 0x2795, 0x2797,
  0x27B0, 0x27B0, 0x27BF, 0x27BF, 0x2B1B, 0x2B1C, 0x2B50, 0x2B50, 0x2B55, 0x2B55,
  0x2E80, 0x2E99, 0x2E9B, 0x2EF3, 0x2F00, 0x2FD5, 0x2FF0, 0x303E, 0x3041, 0x3096,
  0x3099, 0x30FF, 0x3105, 0x312F, 0x3131, 0x318E, 0x3190, 0x31E3, 0x31EF, 0x321E,
  0x3220, 0x3247, 0x3250, 0x4DBF, 0x4E00, 0xA48C, 0xA490, 0xA4C6, 0xA960, 0xA97C,
  0xAC00, 0xD7A3, 0xF900, 0xFAFF, 0xFE10, 0xFE19, 0xFE30, 0xFE52, 0xFE54, 0xFE66,
  0xFE68, 0xFE6B, 0xFF01, 0xFF60, 0xFFE0, 0xFFE6, 0x16FE0, 0x16FE4, 0x16FF0, 0x16FF1,
  0x17000, 0x187F7, 0x18800, 0x18CD5, 0x18D00, 0x18D08, 0x1AFF0, 0x1AFF3, 0x1AFF5, 0x1AFFB,
  0x1AFFD, 0x1AFFE, 0x1B000, 0x1B122, 0x1B132, 0x1B132, 0x1B150, 0x1B152, 0x1B155, 0x1B155,
  0x1B164, 0x1B167, 0x1B170, 0x1B2FB,
];

//: Canonical combining class != 0 — `unicodedata.combining(ch)` truthy.
const COMBINING = [
  0x0300, 0x034E, 0x0350, 0x036F, 0x0483, 0x0487, 0x0591, 0x05BD, 0x05BF, 0x05BF,
  0x05C1, 0x05C2, 0x05C4, 0x05C5, 0x05C7, 0x05C7, 0x0610, 0x061A, 0x064B, 0x065F,
  0x0670, 0x0670, 0x06D6, 0x06DC, 0x06DF, 0x06E4, 0x06E7, 0x06E8, 0x06EA, 0x06ED,
  0x0711, 0x0711, 0x0730, 0x074A, 0x07EB, 0x07F3, 0x07FD, 0x07FD, 0x0816, 0x0819,
  0x081B, 0x0823, 0x0825, 0x0827, 0x0829, 0x082D, 0x0859, 0x085B, 0x0898, 0x089F,
  0x08CA, 0x08E1, 0x08E3, 0x08FF, 0x093C, 0x093C, 0x094D, 0x094D, 0x0951, 0x0954,
  0x09BC, 0x09BC, 0x09CD, 0x09CD, 0x09FE, 0x09FE, 0x0A3C, 0x0A3C, 0x0A4D, 0x0A4D,
  0x0ABC, 0x0ABC, 0x0ACD, 0x0ACD, 0x0B3C, 0x0B3C, 0x0B4D, 0x0B4D, 0x0BCD, 0x0BCD,
  0x0C3C, 0x0C3C, 0x0C4D, 0x0C4D, 0x0C55, 0x0C56, 0x0CBC, 0x0CBC, 0x0CCD, 0x0CCD,
  0x0D3B, 0x0D3C, 0x0D4D, 0x0D4D, 0x0DCA, 0x0DCA, 0x0E38, 0x0E3A, 0x0E48, 0x0E4B,
  0x0EB8, 0x0EBA, 0x0EC8, 0x0ECB, 0x0F18, 0x0F19, 0x0F35, 0x0F35, 0x0F37, 0x0F37,
  0x0F39, 0x0F39, 0x0F71, 0x0F72, 0x0F74, 0x0F74, 0x0F7A, 0x0F7D, 0x0F80, 0x0F80,
  0x0F82, 0x0F84, 0x0F86, 0x0F87, 0x0FC6, 0x0FC6, 0x1037, 0x1037, 0x1039, 0x103A,
  0x108D, 0x108D, 0x135D, 0x135F, 0x1714, 0x1715, 0x1734, 0x1734, 0x17D2, 0x17D2,
  0x17DD, 0x17DD, 0x18A9, 0x18A9, 0x1939, 0x193B, 0x1A17, 0x1A18, 0x1A60, 0x1A60,
  0x1A75, 0x1A7C, 0x1A7F, 0x1A7F, 0x1AB0, 0x1ABD, 0x1ABF, 0x1ACE, 0x1B34, 0x1B34,
  0x1B44, 0x1B44, 0x1B6B, 0x1B73, 0x1BAA, 0x1BAB, 0x1BE6, 0x1BE6, 0x1BF2, 0x1BF3,
  0x1C37, 0x1C37, 0x1CD0, 0x1CD2, 0x1CD4, 0x1CE0, 0x1CE2, 0x1CE8, 0x1CED, 0x1CED,
  0x1CF4, 0x1CF4, 0x1CF8, 0x1CF9, 0x1DC0, 0x1DFF, 0x20D0, 0x20DC, 0x20E1, 0x20E1,
  0x20E5, 0x20F0, 0x2CEF, 0x2CF1, 0x2D7F, 0x2D7F, 0x2DE0, 0x2DFF, 0x302A, 0x302F,
  0x3099, 0x309A, 0xA66F, 0xA66F, 0xA674, 0xA67D, 0xA69E, 0xA69F, 0xA6F0, 0xA6F1,
  0xA806, 0xA806, 0xA82C, 0xA82C, 0xA8C4, 0xA8C4, 0xA8E0, 0xA8F1, 0xA92B, 0xA92D,
  0xA953, 0xA953, 0xA9B3, 0xA9B3, 0xA9C0, 0xA9C0, 0xAAB0, 0xAAB0, 0xAAB2, 0xAAB4,
  0xAAB7, 0xAAB8, 0xAABE, 0xAABF, 0xAAC1, 0xAAC1, 0xAAF6, 0xAAF6, 0xABED, 0xABED,
  0xFB1E, 0xFB1E, 0xFE20, 0xFE2F, 0x101FD, 0x101FD, 0x102E0, 0x102E0, 0x10376, 0x1037A,
  0x10A0D, 0x10A0D, 0x10A0F, 0x10A0F, 0x10A38, 0x10A3A, 0x10A3F, 0x10A3F, 0x10AE5, 0x10AE6,
  0x10D24, 0x10D27, 0x10EAB, 0x10EAC, 0x10EFD, 0x10EFF, 0x10F46, 0x10F50, 0x10F82, 0x10F85,
  0x11046, 0x11046, 0x11070, 0x11070, 0x1107F, 0x1107F, 0x110B9, 0x110BA, 0x11100, 0x11102,
  0x11133, 0x11134, 0x11173, 0x11173, 0x111C0, 0x111C0, 0x111CA, 0x111CA, 0x11235, 0x11236,
  0x112E9, 0x112EA, 0x1133B, 0x1133C, 0x1134D, 0x1134D, 0x11366, 0x1136C, 0x11370, 0x11374,
  0x11442, 0x11442, 0x11446, 0x11446, 0x1145E, 0x1145E, 0x114C2, 0x114C3, 0x115BF, 0x115C0,
  0x1163F, 0x1163F, 0x116B6, 0x116B7, 0x1172B, 0x1172B, 0x11839, 0x1183A, 0x1193D, 0x1193E,
  0x11943, 0x11943, 0x119E0, 0x119E0, 0x11A34, 0x11A34, 0x11A47, 0x11A47, 0x11A99, 0x11A99,
  0x11C3F, 0x11C3F, 0x11D42, 0x11D42, 0x11D44, 0x11D45, 0x11D97, 0x11D97, 0x11F41, 0x11F42,
  0x16AF0, 0x16AF4, 0x16B30, 0x16B36, 0x16FF0, 0x16FF1, 0x1BC9E, 0x1BC9E, 0x1D165, 0x1D169,
  0x1D16D, 0x1D172, 0x1D17B, 0x1D182, 0x1D185, 0x1D18B, 0x1D1AA, 0x1D1AD, 0x1D242, 0x1D244,
  0x1E000, 0x1E006, 0x1E008, 0x1E018, 0x1E01B, 0x1E021, 0x1E023, 0x1E024, 0x1E026, 0x1E02A,
  0x1E08F, 0x1E08F, 0x1E130, 0x1E136, 0x1E2AE, 0x1E2AE, 0x1E2EC, 0x1E2EF, 0x1E4EC, 0x1E4EF,
  0x1E8D0, 0x1E8D6, 0x1E944, 0x1E94A,
];

/** Binary search over a flat [start, end, start, end, …] range table. */
function inRanges(table, cp) {
  let lo = 0;
  let hi = table.length / 2 - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cp < table[mid * 2]) hi = mid - 1;
    else if (cp > table[mid * 2 + 1]) lo = mid + 1;
    else return true;
  }
  return false;
}

/**
 * `_dwidth` — display width of `s` in terminal columns.
 *
 * `for (const ch of s)` iterates by CODE POINT, which is what `for ch in s` does on the
 * reference side; a `for (let i …)` loop over UTF-16 units would count every emoji twice.
 */
export function dwidth(s) {
  let w = 0;
  let prev = 0;
  for (const ch of s) {
    if (ch === '️') {          // emoji-presentation selector: base becomes wide
      if (prev === 1) { w += 1; prev = 2; }
      continue;
    }
    if (ch === '︎') continue;  // text-presentation selector: leave the base as-is
    const cp = ch.codePointAt(0);
    if (inRanges(COMBINING, cp)) { prev = 0; continue; }
    const cw = (cp >= 0x1F000 || inRanges(WIDE, cp)) ? 2 : 1;
    w += cw;
    prev = cw;
  }
  return w;
}

/** `_truncd` — truncate to at most `width` display columns, never splitting a glyph. */
export function truncd(s, width) {
  if (width <= 0) return '';
  if (dwidth(s) <= width) return s;
  let out = '';
  let w = 0;
  for (const ch of s) {
    const cw = dwidth(ch);
    if (w + cw > width) break;
    out += ch;
    w += cw;
  }
  return out;
}

/** `_fit` — truncate to `width` display columns, then pad to exactly `width`. */
export function fit(s, width) {
  const t = truncd(s, width);
  return t + ' '.repeat(Math.max(0, width - dwidth(t)));
}

// ---- glyph tables --------------------------------------------------------------------

const ICONS = {
  browse: ['📖', '▤', '#'],
  diff: ['🔍', '≈', '~'],
  setup: ['🧩', '⊞', '%'],
  theme: ['🎨', '◈', '*'],
  update: ['🔄', '↻', '@'],
  bootstrap: ['🚀', '⇧', '^'],
  build: ['🔨', '⚒', '+'],
  memory: ['🧠', '❖', '&'],
  status: ['📊', '▦', '='],
  settings: ['🔧', '⚙', '%'],
  quit: ['🚪', '✕', 'x'],
  doctor: ['🩺', '✚', '+'],
  mcp: ['🔌', '⊕', '&'],
  link: ['🔗', '∞', '&'],
  unlink: ['🔓', '∝', '-'],
  uninstall: ['🗑', '⊗', 'x'],
  back: ['🔙', '←', '<'],
  agent: ['🤖', '◆', '@'],
  skill: ['✨', '✦', '*'],
  law: ['📜', '§', '#'],
  library: ['📚', '❒', 'L'],
  notebook: ['📓', '✎', 'N'],
  wiki: ['📘', '▥', 'W'],
  config: ['🧾', '⌗', 'C'],
  badge: ['🧬', '⬡', 'G'],
  web: ['🌐', '◍', 'W'],
};

/** `_icon` — the icon for `name` in the active display tier. */
export function icon(name) {
  // `_ICONS.get(name, (...))`, and `Object.hasOwn` rather than a truthiness test so a name
  // like `constructor` cannot reach up the prototype chain and answer with a function.
  const [emoji, sym, asc] = Object.hasOwn(ICONS, name) ? ICONS[name] : ['•', '•', '*'];
  return TUI_ASCII ? asc : (TUI_EMOJI ? emoji : sym);
}

const MARKS = {
  ok: ['✅', '✓', '+'],
  fail: ['❌', '✗', 'x'],
  warn: ['⚠️', '!', '!'],
  info: ['ℹ️', '·', '-'],
  pending: ['·', '·', '-'],
  edited: ['📝', '~', '~'],
  added: ['🆕', '+', '+'],
  missing: ['🗑', '-', '-'],
  mcp_on: ['🟢', '●', 'x'],
  mcp_off: ['⚪', '○', '~'],
  mcp_absent: ['⚫', '·', ' '],
};

/** `_mark` — status glyph for ok/fail/warn/info in the active tier. */
export function mark(kind) {
  const [emoji, sym, asc] = Object.hasOwn(MARKS, kind) ? MARKS[kind] : ['•', '·', '-'];
  return TUI_ASCII ? asc : (TUI_EMOJI ? emoji : sym);
}

const SPIN = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏';

/** `_spin` — one spinner frame for tick `i`; a static dot in the non-animated tiers. */
export function spin(i) {
  if (!TUI_ANIM) return TUI_ASCII ? '-' : '·';
  const frames = TUI_ASCII ? '|/-\\' : SPIN;
  // `frames[i % len]` on the reference indexes CODE POINTS; the braille frames are BMP so
  // UTF-16 indexing agrees, but spelling it through `[...frames]` keeps that an argument
  // about the data rather than a coincidence. Python's `%` on a negative `i` returns a
  // non-negative remainder and JavaScript's does not, so the modulo is corrected.
  const f = [...frames];
  return f[((i % f.length) + f.length) % f.length];
}

const LOGO_FONT = {
  G: [' ### ', '#    ', '# ## ', '#  # ', ' ### '],
  E: ['#### ', '#    ', '###  ', '#    ', '#### '],
  N: ['#   #', '##  #', '# # #', '#  ##', '#   #'],
  S: [' ####', '#    ', ' ### ', '    #', '#### '],
  D: ['###  ', '#  # ', '#   #', '#  # ', '###  '],
};

/** `_logo_lines` — the GENESEED wordmark as 5 text rows. */
export function logoLines() {
  const ink = TUI_ASCII ? '#' : '█';
  const rows = [];
  for (let r = 0; r < 5; r += 1) {
    rows.push([...'GENESEED'].map((c) => LOGO_FONT[c][r].replaceAll('#', ink)).join(' '));
  }
  return rows;
}

// ---- layout maths --------------------------------------------------------------------

/** `_clamp` — clamp a scroll offset so [top, top+viewH) stays inside `total`. */
export function clamp(top, total, viewH) {
  return Math.max(0, Math.min(top, Math.max(0, total - viewH)));
}

const BAR_EIGHTHS = ' ▏▎▍▌▋▊▉█';

/** `_progress_bar` — a determinate bar exactly `width` display columns wide. */
export function progressBar(frac, width = 24) {
  const f = Math.max(0.0, Math.min(1.0, frac));
  if (TUI_ASCII) {
    const filled = pyRound(f * width);
    return '#'.repeat(filled) + '-'.repeat(width - filled);
  }
  const eighths = pyRound(f * width * 8);
  const full = Math.floor(eighths / 8);
  const rem = eighths % 8;
  if (full >= width) return '█'.repeat(width);
  return '█'.repeat(full) + [...BAR_EIGHTHS][rem] + ' '.repeat(width - full - 1);
}

/**
 * `round()` — Python rounds HALF TO EVEN and `Math.round` rounds half UP, and this is the
 * one place in the file where that shows: a bar at exactly 0.5 of a cell is the frontier
 * case the eighths resolution exists to draw, and `round(0.5)` is 0 there and 1 here.
 */
function pyRound(x) {
  const f = Math.floor(x);
  const d = x - f;
  if (d > 0.5) return f + 1;
  if (d < 0.5) return f;
  return f % 2 === 0 ? f : f + 1;
}

// ---- theme reads ---------------------------------------------------------------------

/** `_theme_preview` — right-panel preview rows for a theme, as (kind, text) pairs. */
export function themePreview(key) {
  const data = readJsonMaybe(path.join(THEMES, `${key}.json`));
  if (!data || typeof data !== 'object') return [['dim', '(no preview available)']];
  const lines = [['title', key], ['', '']];
  if (data.TAGLINE) lines.push(['dim', data.TAGLINE], ['', '']);
  if (data.LOADED_SIGIL) lines.push(['ok', data.LOADED_SIGIL], ['', '']);
  if (data.VOICE) lines.push(['', `Voice — ${data.VOICE}`], ['', '']);
  if (data.LEX_I) lines.push(['', `e.g.  Rule I — ${data.LEX_I}`]);
  if (data.BENEDICTION) lines.push(['', ''], ['dim', data.BENEDICTION]);
  return lines;
}

/** `_theme_flair` — the voice elements the setup chrome speaks in once a theme is chosen. */
export function themeFlair(theme) {
  const data = readJsonMaybe(path.join(THEMES, `${theme}.json`)) || {};
  const banner = data.BANNER ?? '';
  return {
    accent: data.ACCENT ?? 'cyan',
    tagline: data.TAGLINE ?? '',
    sigil: data.LOADED_SIGIL ?? '',
    // `str.splitlines()` — `js/lib/pydiff.mjs`' twin, already gated. It answers `[]` for
    // the empty string where `''.split('\n')` answers `['']`, which would put a blank row
    // in the banner of every theme that omits one; and its boundary set is Python's rather
    // than `\s`, which P6d measured apart.
    banner: pySplitLines(banner),
    benediction: data.BENEDICTION ?? '',
  };
}

// ---- the inventory's two consumers ----------------------------------------------------

/**
 * `_tui_entries` — the ordered (kind, label, data) rows for the left list. `head` is a
 * section divider and is not selectable.
 */
export function tuiEntries(inv) {
  const rows = [['head', `AGENTS (${inv.agents.length})`, null]];
  for (const e of inv.agents) rows.push(['agent', e.name, e]);
  rows.push(['head', `SKILLS (${inv.skills.length})`, null]);
  for (const e of inv.skills) rows.push(['skill', e.name, e]);
  rows.push(['head', `LAWS (${inv.laws.length})`, null]);
  for (const e of inv.laws) rows.push(['law', `Rule ${e.num} — ${e.title}`, e]);
  return rows;
}

/**
 * `_detail_lines` — right-pane content for the selected entry.
 *
 * The reference falls off the end for every other `kind`, so it returns `None` — not `[]`.
 * `null` here, because a caller that treated the two alike would render an empty pane where
 * the reference renders nothing at all.
 *
 * ⚠ A REFERENCE BUG LIVES ON THIS RETURN, FOUND BY P7B'S CORPUS AND DELIBERATELY NOT FIXED
 * (it is in the panel, which is P7c's). `_tui_loop` does, at `_harness_tui.py`:614:
 *
 *     wrapped = _wrap_lines(_detail_lines(kind, label, data), riw)
 *
 * and `_wrap_lines` iterates its argument. For a `head` row `_detail_lines` returns `None`,
 * so that is a `TypeError: 'NoneType' object is not iterable`. It is normally unreachable
 * because line 554 moves `sel` onto the first SELECTABLE row — but line 555 is
 * `if not selectable: sel = 0`, and row 0 is always the AGENTS header. So an inventory with
 * no agents, no skills AND no laws crashes the panel on its first frame instead of drawing
 * an empty state. `_TUI_INV_EMPTY` in `tests/test_pure_function_parity.py` is the corpus
 * entry that surfaced it. **P7c must not reproduce the crash when it ports `_tui_loop`** —
 * the fix is one `or []` at the call site, and it belongs in the same change as the port.
 */
export function detailLines(kind, label, data) {
  if (kind === 'law') return [label, ''].concat(data ? pySplitLines(data.body) : []);
  if ((kind === 'agent' || kind === 'skill') && data) return pySplitLines(data.body);
  return null;
}

// ---- the verb ------------------------------------------------------------------------

/**
 * `cmd_tui`. Arm one is the reachable one and is byte for byte; the panel is P7c's and this
 * falls back through `cmd_tui`'s own `except` arm — see this module's header.
 */
export function cmdTui() {
  if (!process.stdin.isTTY) {
    pyPrint('[tui] not an interactive terminal. Use `harness setup`, `doctor`, or `build`.\n');
    return 1;
  }
  pyPrint('[tui] full-screen panel unavailable (the Node entry carries the TUI\'s layout '
    + 'half, not its screens — run `python rituals/harness.py tui` for the panel). '
    + 'Use `harness setup`, `doctor`, or `build`.\n');
  return 1;
}
