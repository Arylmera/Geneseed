/**
 * `rituals/theme_anim.py` — the per-theme install animation the LINE wizard plays.
 *
 * P7c, and the one leftover of that phase that is NOT the declared curses panel. P5i ported
 * `_setup_lines` and left this out with a note — "belongs to P7 with the rest of the terminal
 * layer" — and the rest of the terminal layer turned out to be the panel, which stays
 * declared (`tests/test_tui_boundary.py` says why, and asserts it). This module is the part
 * that has nothing to do with curses: it draws on the ORDINARY terminal, with cursor-up
 * escapes and a sleep, and its only caller is a function that already crossed.
 *
 * SO IT IS NOT IN `js/tui.mjs`, DELIBERATELY. That module carries a structural assertion that
 * it contains no escape sequence at all — the thing that makes "the panel is declared" a
 * measurement instead of a promise. This file necessarily contains `\x1b[{n}A`, so putting it
 * there would have turned that assertion red and invited someone to weaken it. A line-mode
 * animation and a full-screen panel are different subsystems in the reference too: they live
 * in different files there and they do here.
 *
 * WHAT THE PYTHON DOES THAT THIS DOES NOT, and it is one line. `_anim_ok` calls
 * `os.system("")` on Windows, whose only purpose is the side effect of making the console
 * enable VT/ANSI processing; it is not a probe and its return value is discarded. Node's
 * console writer already enables virtual-terminal processing on Windows when stdout is a TTY
 * (libuv does it when the stream is opened), so the effect is present and the call is not
 * needed — which is fortunate, because it is a `child_process` spawn and this port is barred
 * from those. The consequence is that the reference's `except Exception: return False` arm
 * around it has no counterpart here. That arm needs `cmd.exe` to be unlaunchable on a machine
 * that has already reached an interactive wizard, and `anim_ok` is compared over ten
 * environments in `tests/test_pure_function_parity.py` — none of which can produce it on
 * either side.
 *
 * WHAT GATES IT. `tests/test_pure_function_parity.py`'s `_theme_anim_cases()`: `art_for` over
 * every key plus the prototype-chain names, `_place`/`_tile`/`_height` over their arithmetic,
 * `_anim_ok` over its whole decision table, and `play_line` itself over 24 environments —
 * captured on the reference side through a real `TextIOWrapper`, so the CRLF translation is
 * inside the comparison rather than outside it.
 */
import { printOut } from '../lib/fs.mjs';
import { parseIntStrict, codePointLength, padEndToWidth } from '../lib/text.mjs';

export const ART = {
  imperial: {
    title: '+ ADEPTUS ASTARTES +',
    sprite: [
      ['   .---.   ', '  |[o o]|  ', '<#|=====|#====-', '  | ### |  ', '  /     \\  '],
      ['   .---.   ', '  |[o o]|  ', '<#|=====|#====-', '  | ### |  ', '  \\     /  '],
    ],
    ground: '_',
    card: [
      '        |>>|        ',
      "     .--'=='--.     ",
      '    |[ O    O ]|    ',
      '  <#|==========|#===---',
      '    |  ::##::  |    ',
      '    /          \\    ',
      '   THE EMPEROR PROTECTS',
    ],
  },
  pirate: {
    title: '~ HOIST THE COLOURS ~',
    sprite: [
      ['    |    ', '   /|\\   ', '  /_|_\\  ', ' \\=====/ '],
      ['    |    ', '   /|\\   ', '  /_|_\\  ', ' \\=====/ '],
    ],
    ground: '~^~ ',
    card: [
      '         |    |         ',
      '        /|\\  /|         ',
      '       /_|_\\/_|         ',
      '   __|~~~~~~~~~~|__      ',
      '   \\===== JOLLY ====/    ',
      ' ~^~~^~~^~~^~~^~~^~~^~~  ',
      '      DEAD MEN TELL NO TALES',
    ],
  },
  cyberpunk: {
    title: '>_ JACK IN',
    sprite: [
      ['1 0  01  1 0', ' 0 11 0  1 0', '0  1  10 0 1', ' 11 0  1  10'],
      ['0 1  10  0 1', ' 1 00 1  0 1', '1  0  01 1 0', ' 00 1  0  01'],
    ],
    ground: '=-',
    card: [
      ' 010  1  0 11  0 1  010 ',
      '1  01 0 11  0  1 00  1 0',
      ' 11  0  WAKE UP  1  0 1 ',
      '0  1 01  0 11  0 1  00 1',
      ' 1 0  THE NET IS YOURS 0',
      '=-=-=-=-=-=-=-=-=-=-=-=-',
    ],
  },
  gamer: {
    title: '* PRESS START *',
    sprite: [
      ['  ___        ', ' /C  o  o  o ', ' \\___        '],
      ['  ___        ', ' (c   o  o  o', ' \\___        '],
    ],
    ground: '.',
    card: [
      '   ___                  .oOo.   ',
      '  /C   o  o  o  o  o    | x x |  ',
      '  \\___                 |__o__|  ',
      '  HI-SCORE  999999    1UP  x3   ',
      '  >>> LEVEL CLEARED <<<         ',
    ],
  },
  military: {
    title: '[ ADVANCE - MOVE OUT ]',
    sprite: [
      ['    ____      ', ' __/    \\__==-', '|  o  o  o |  ', "'-O-O-O-O-'  "],
      ['    ____      ', ' __/    \\__==-', '|  o  o  o |  ', "'O-O-O-O-O'  "],
    ],
    ground: '^',
    card: [
      '        ____            ',
      '     __/    \\_____===-   ',
      '    | o   o   o   |      ',
      "    '-O-O-O-O-O-O-'      ",
      '  ^^^^^^^^^^^^^^^^^^^^   ',
      '    MISSION  GO  GO  GO  ',
    ],
  },
  sports: {
    title: '<< GAME ON >>',
    sprite: [
      ['   (o)      |‾|', '           | |', '  _________|_|'],
      ['      (o)   |‾|', '           | |', '  _________|_|'],
    ],
    ground: '_',
    card: [
      '                    .---.   ',
      '      (o)           |   |   ',
      '     /              | G |   ',
      '  ________________  |_O_|   ',
      '   >>>  GOOOAAL !!!  <<<    ',
    ],
  },
  wizard: {
    title: '~* CAST THE RITE *~',
    sprite: [
      ['    ,*  .   ', '   /|   *   ', '  (o o)  .  ', '  /|*|\\ *   ', '   | |     '],
      ['    .  *,   ', '   /|  .    ', '  (o o) *   ', '  /|*|\\  .  ', '   | |     '],
    ],
    ground: '.',
    card: [
      '         ,*.    *  .        ',
      '        /|   *   .   *      ',
      '       (o  o)  .  *   .     ',
      '       /|**|\\   *    *      ',
      '        |  |   .  THE       ',
      '      ARCANE IS BOUND       ',
    ],
  },
  neutral: {
    title: 'Geneseed',
    sprite: [
      ['>>>        '],
      ['   >>>     '],
      ['      >>>  '],
    ],
    ground: '',
    card: [
      '  [############------]  ',
      '  harness ready.        ',
    ],
  },
};

export const DEFAULT = 'neutral';

/**
 * `theme_anim.art_for` — `ART.get(theme, ART[DEFAULT])`.
 *
 * `Object.hasOwn`, not `ART[theme] ?? ART[DEFAULT]`. `ART['constructor']` is a function on
 * the prototype chain and therefore not nullish, so the `??` spelling would hand a Function
 * back to `play_line` where the reference hands back the neutral theme. The third table in
 * this port to carry the trap — `_icon` and `_mark` were the first two — and the corpus
 * names all four inherited keys.
 */
export function artFor(theme) {
  return Object.hasOwn(ART, theme) ? ART[theme] : ART[DEFAULT];
}

/** A code-point slice — Python's `s[a:b]`, which does not count UTF-16 units. */
const cut = (s, a, b) => Array.from(s).slice(a, b).join('');

/**
 * `shutil.get_terminal_size((80, 24)).columns`.
 *
 * `parseIntStrict` and not `parseInt`, and the corpus has a case for exactly that: Python's `int()`
 * refuses `'80x'` outright and `get_terminal_size` swallows the ValueError into the fallback,
 * where `parseInt('80x')` is a cheerful 80. A width one column off is invisible in a terminal
 * and loud in a byte comparison. `<= 0` is the reference's own guard, which is why `'0'` and
 * `'-5'` fall through to the fallback rather than producing a zero-width canvas.
 */
function terminalColumns() {
  const env = parseIntStrict(process.env.COLUMNS);
  if (env !== null && env > 0) return env;
  // `sys.__stdout__` over there, `process.stdout` here. Both are undefined-ish off a
  // terminal, and both then take the (80, 24) fallback.
  const real = process.stdout.columns;
  return typeof real === 'number' && real > 0 ? real : 80;
}

/**
 * `theme_anim._anim_ok` — whether an in-place ANSI animation is safe here.
 *
 * ⚠ TERM=dumb AND TERM UNSET ARE NOT REFUSALS ON WINDOWS. The reference guards that branch
 * with `if os.name != "nt"`, so on Windows a dumb TERM still animates — which is right,
 * because TERM is not what a Windows console is configured by. Reading the branch as an
 * unconditional refusal would disable the animation on the only platform whose users get the
 * line wizard by default.
 */
export function animOk() {
  if (process.env.GENESEED_NO_ANIM || process.env.GENESEED_TUI_PLAIN) return false;
  if (!process.stdout.isTTY) return false;
  const term = (process.env.TERM || '').toLowerCase();
  if (term === 'dumb' || term === '') {
    if (process.platform !== 'win32') return false;
  }
  // The reference's `os.system("")` goes here; see the module header for why it does not.
  return true;
}

/** `theme_anim._place` — a sprite row drawn at column `x`, clipped to `width`. */
export function place(row, x, width) {
  const s = x >= 0 ? ' '.repeat(x) + row : cut(row, -x);
  return cut(s, 0, width);
}

/**
 * `theme_anim._tile` — the ground line, scrolled by `phase`.
 *
 * Two Python arithmetic rules, both of which JavaScript spells differently. `width //
 * len(tile)` is FLOOR division, so a negative width gives a negative repeat count — which
 * Python turns into an empty string and `String.repeat` turns into a RangeError, hence the
 * clamp. And `phase % len(tile)` is non-negative in Python for a positive divisor while
 * JavaScript keeps the sign of the dividend, so a negative phase indexes off the front of the
 * string instead of wrapping to the end. `_spin` had the same trap in P7b.
 */
export function tile(tileStr, width, phase = 0) {
  if (!tileStr) return '';
  const n = codePointLength(tileStr);
  const base = tileStr.repeat(Math.max(0, Math.floor(width / n) + 2));
  const off = ((phase % n) + n) % n;
  return cut(base, off, off + width);
}

/** `theme_anim._height` — `max((len(p) for p in poses), default=0)`. */
export function height(poses) {
  return Math.max(0, ...poses.map((p) => p.length));
}

/**
 * `str.center(width)`, which is not `padStart`+`padEnd` and not symmetric.
 *
 * CPython's `stringlib` computes `left = marg // 2 + (marg & width & 1)`, and that last term
 * is a genuine oddity rather than a rounding convention: when the margin AND the width are
 * both odd the extra column goes on the LEFT, and otherwise on the right. Nothing about
 * "centre this" implies it. The title line of every animation is the only caller.
 */
function centerText(s, width) {
  const marg = width - codePointLength(s);
  if (marg <= 0) return s;
   
  const left = Math.floor(marg / 2) + (marg & width & 1);
  return ' '.repeat(left) + s + ' '.repeat(marg - left);
}

/** `time.sleep(seconds)`, synchronously. `Atomics.wait` is the stdlib's only sync sleep. */
const sleep = (ms) => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
};

/**
 * `theme_anim.play_line` — scroll the themed sprite, then settle on the static card.
 *
 * Never raises: the reference wraps the animation in `except Exception` and degrades to the
 * static card, and `_setup_lines` wraps the whole call again in a bare `except: pass` marked
 * "cosmetic only — never block a successful install". Both layers are kept. A failed
 * animation must not be able to fail an install that already succeeded.
 */
export function playLine(theme, ok = true) {
  const art = artFor(theme);
  const width = Math.min(terminalColumns() - 1, 56);
  printOut('\n');
  printOut(`${centerText(art.title, width)}\n`);
  if (!ok) return;
  if (!animOk()) {
    for (const r of art.card) printOut(`${cut(r, 0, width)}\n`);
    printOut('\n');
    return;
  }
  const poses = art.sprite;
  const ground = art.ground || '';
  const h = height(poses);
  const canvasH = h + (ground ? 1 : 0);
  const spriteW = Math.max(0, ...poses.flatMap((p) => p.map((r) => codePointLength(r))));
  try {
    printOut('\n'.repeat(canvasH));
    const steps = Math.min(width + spriteW, 64);      // cap to ~1.6s of motion
    for (let i = 0; i <= steps; i += 1) {
      const pose = poses[Math.floor(i / 3) % poses.length];
      const x = width - i;                            // enter from the right, travel left
      const lines = [];
      for (let r = 0; r < h; r += 1) lines.push(place(r < pose.length ? pose[r] : '', x, width));
      if (ground) lines.push(tile(ground, width, i));
      printOut(`\x1b[${canvasH}A`);
      for (const ln of lines) printOut(`\r${cut(padEndToWidth(ln, width), 0, width)}\n`);
      sleep(25);
    }
    // settle on the card
    printOut(`\x1b[${canvasH}A`);
    const card = art.card;
    for (let r = 0; r < canvasH; r += 1) {
      const row = r < card.length ? cut(card[r], 0, width) : '';
      printOut(`\r${cut(padEndToWidth(row, width), 0, width)}\n`);
    }
    // any extra card rows beyond the canvas
    for (let r = canvasH; r < card.length; r += 1) printOut(`${cut(card[r], 0, width)}\n`);
    printOut('\n');
  } catch {
    // Terminal didn't cooperate — leave a clean static card.
    try {
      for (const r of art.card) printOut(`${cut(r, 0, width)}\n`);
      printOut('\n');
    } catch { /* nothing left to try */ }
  }
}
