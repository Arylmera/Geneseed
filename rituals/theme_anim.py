"""Per-theme install animations for the Geneseed setup flow.

Pure stdlib, ASCII-only art (renders on every terminal/font). Two consumers:
  - line mode (Windows / no-curses): `play_line()` animates a scrolling sprite in
    place via ANSI cursor moves, then settles on a big static "card". Falls back to
    printing the card once when ANSI/animation isn't safe.
  - curses mode (mac/Linux setup flow): `art_for()` feeds harness.py's themed build
    screen, which scrolls the same sprite with curses while the harness builds.

Disable with GENESEED_NO_ANIM=1 or GENESEED_TUI_PLAIN=1 (static card only).
"""
from __future__ import annotations

import os
import shutil
import sys
import time

# Each theme: title line, >=1 sprite POSES (cycled for motion), an optional ground
# tile drawn under the sprite, and a big static reveal CARD. Pure ASCII on purpose.
ART: dict[str, dict] = {
    "imperial": {
        "title": "+ ADEPTUS ASTARTES +",
        "sprite": [
            ["   .---.   ", "  |[o o]|  ", "<#|=====|#====-", "  | ### |  ", "  /     \\  "],
            ["   .---.   ", "  |[o o]|  ", "<#|=====|#====-", "  | ### |  ", "  \\     /  "],
        ],
        "ground": "_",
        "card": [
            "        |>>|        ",
            "     .--'=='--.     ",
            "    |[ O    O ]|    ",
            "  <#|==========|#===---",
            "    |  ::##::  |    ",
            "    /          \\    ",
            "   THE EMPEROR PROTECTS",
        ],
    },
    "pirate": {
        "title": "~ HOIST THE COLOURS ~",
        "sprite": [
            ["    |    ", "   /|\\   ", "  /_|_\\  ", " \\=====/ "],
            ["    |    ", "   /|\\   ", "  /_|_\\  ", " \\=====/ "],
        ],
        "ground": "~^~ ",
        "card": [
            "         |    |         ",
            "        /|\\  /|         ",
            "       /_|_\\/_|         ",
            "   __|~~~~~~~~~~|__      ",
            "   \\===== JOLLY ====/    ",
            " ~^~~^~~^~~^~~^~~^~~^~~  ",
            "      DEAD MEN TELL NO TALES",
        ],
    },
    "cyberpunk": {
        "title": ">_ JACK IN",
        "sprite": [
            ["1 0  01  1 0", " 0 11 0  1 0", "0  1  10 0 1", " 11 0  1  10"],
            ["0 1  10  0 1", " 1 00 1  0 1", "1  0  01 1 0", " 00 1  0  01"],
        ],
        "ground": "=-",
        "card": [
            " 010  1  0 11  0 1  010 ",
            "1  01 0 11  0  1 00  1 0",
            " 11  0  WAKE UP  1  0 1 ",
            "0  1 01  0 11  0 1  00 1",
            " 1 0  THE NET IS YOURS 0",
            "=-=-=-=-=-=-=-=-=-=-=-=-",
        ],
    },
    "gamer": {
        "title": "* PRESS START *",
        "sprite": [
            ["  ___        ", " /C  o  o  o ", " \\___        "],
            ["  ___        ", " (c   o  o  o", " \\___        "],
        ],
        "ground": ".",
        "card": [
            "   ___                  .oOo.   ",
            "  /C   o  o  o  o  o    | x x |  ",
            "  \\___                 |__o__|  ",
            "  HI-SCORE  999999    1UP  x3   ",
            "  >>> LEVEL CLEARED <<<         ",
        ],
    },
    "military": {
        "title": "[ ADVANCE - MOVE OUT ]",
        "sprite": [
            ["    ____      ", " __/    \\__==-", "|  o  o  o |  ", "'-O-O-O-O-'  "],
            ["    ____      ", " __/    \\__==-", "|  o  o  o |  ", "'O-O-O-O-O'  "],
        ],
        "ground": "^",
        "card": [
            "        ____            ",
            "     __/    \\_____===-   ",
            "    | o   o   o   |      ",
            "    '-O-O-O-O-O-O-'      ",
            "  ^^^^^^^^^^^^^^^^^^^^   ",
            "    MISSION  GO  GO  GO  ",
        ],
    },
    "sports": {
        "title": "<< GAME ON >>",
        "sprite": [
            ["   (o)      |‾|", "           | |", "  _________|_|"],
            ["      (o)   |‾|", "           | |", "  _________|_|"],
        ],
        "ground": "_",
        "card": [
            "                    .---.   ",
            "      (o)           |   |   ",
            "     /              | G |   ",
            "  ________________  |_O_|   ",
            "   >>>  GOOOAAL !!!  <<<    ",
        ],
    },
    "wizard": {
        "title": "~* CAST THE RITE *~",
        "sprite": [
            ["    ,*  .   ", "   /|   *   ", "  (o o)  .  ", "  /|*|\\ *   ", "   | |     "],
            ["    .  *,   ", "   /|  .    ", "  (o o) *   ", "  /|*|\\  .  ", "   | |     "],
        ],
        "ground": ".",
        "card": [
            "         ,*.    *  .        ",
            "        /|   *   .   *      ",
            "       (o  o)  .  *   .     ",
            "       /|**|\\   *    *      ",
            "        |  |   .  THE       ",
            "      ARCANE IS BOUND       ",
        ],
    },
    "neutral": {
        "title": "Geneseed",
        "sprite": [
            [">>>        "],
            ["   >>>     "],
            ["      >>>  "],
        ],
        "ground": "",
        "card": [
            "  [############------]  ",
            "  harness ready.        ",
        ],
    },
}

DEFAULT = "neutral"


def art_for(theme: str) -> dict:
    return ART.get(theme, ART[DEFAULT])


def _anim_ok() -> bool:
    """True when an in-place ANSI animation is safe: an interactive TTY, not a dumb
    terminal, and not disabled. On Windows 10+, `os.system("")` flips on VT/ANSI
    processing for the current console."""
    if os.environ.get("GENESEED_NO_ANIM") or os.environ.get("GENESEED_TUI_PLAIN"):
        return False
    if not sys.stdout.isatty():
        return False
    if (os.environ.get("TERM") or "").lower() in ("dumb", ""):
        if os.name != "nt":
            return False
    if os.name == "nt":
        try:
            os.system("")        # enable ANSI escape processing on modern Windows consoles
        except Exception:
            return False
    return True


def _place(row: str, x: int, width: int) -> str:
    """A sprite row drawn at column x (may be partly off either edge), clipped to width."""
    if x >= 0:
        s = (" " * x) + row
    else:
        s = row[-x:]
    return s[:width]


def _tile(tile: str, width: int, phase: int = 0) -> str:
    if not tile:
        return ""
    base = tile * (width // len(tile) + 2)
    off = phase % len(tile)
    return base[off:off + width]


def _height(poses: list) -> int:
    return max((len(p) for p in poses), default=0)


def play_line(theme: str, ok: bool = True) -> None:
    """Line-mode install animation: scroll the themed sprite across the screen, then
    settle on the static card. Never raises — any failure degrades to the static card."""
    art = art_for(theme)
    width = min(shutil.get_terminal_size((80, 24)).columns - 1, 56)
    print()
    print(art["title"].center(width))
    if not ok:
        return
    if not _anim_ok():
        for r in art["card"]:
            print(r[:width])
        print()
        return
    poses = art["sprite"]
    ground = art.get("ground", "")
    h = _height(poses)
    canvas_h = h + (1 if ground else 0)
    sprite_w = max((len(r) for p in poses for r in p), default=0)
    try:
        sys.stdout.write("\n" * canvas_h)
        steps = width + sprite_w
        steps = min(steps, 64)            # cap to ~1.6s of motion
        for i in range(steps + 1):
            pose = poses[(i // 3) % len(poses)]
            x = width - i                 # enter from the right, travel left
            lines = [_place(pose[r] if r < len(pose) else "", x, width) for r in range(h)]
            if ground:
                lines.append(_tile(ground, width, phase=i))
            sys.stdout.write(f"\x1b[{canvas_h}A")
            for ln in lines:
                sys.stdout.write("\r" + ln.ljust(width)[:width] + "\n")
            sys.stdout.flush()
            time.sleep(0.025)
        # settle on the card
        sys.stdout.write(f"\x1b[{canvas_h}A")
        card = art["card"]
        for r in range(canvas_h):
            row = card[r][:width] if r < len(card) else ""
            sys.stdout.write("\r" + row.ljust(width)[:width] + "\n")
        # any extra card rows beyond the canvas
        for r in range(canvas_h, len(card)):
            print(card[r][:width])
        sys.stdout.flush()
        print()
    except Exception:
        # Terminal didn't cooperate — leave a clean static card.
        try:
            for r in art["card"]:
                print(r[:width])
            print()
        except Exception:
            pass


if __name__ == "__main__":          # quick manual preview: python rituals/theme_anim.py pirate
    play_line(sys.argv[1] if len(sys.argv) > 1 else "imperial", True)
