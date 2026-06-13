"""Geneseed harness — Version verdict and the headless install dashboard.

Part of the harness CLI (see harness.py). Imports the shared toolset from
_harness_core; cross-submodule names are linked at import time by harness.py,
so this file is only ever used through `import harness`."""
from __future__ import annotations

from _harness_core import *  # noqa: F401,F403  shared stdlib + primitives



# ---- version + uninstall (deployed-install lifecycle) ----------------------------

def _version_verdict(installed: "str | None", current: str) -> str:
    """One-line verdict comparing a deployed fingerprint to the current source."""
    if installed is None:
        return "no Geneseed install detected to compare"
    if installed == current:
        return "up to date with this source"
    return ("installed build differs from the current source — run "
            "`./geneseed update` (or rebuild) to apply it")


def cmd_version(args: argparse.Namespace) -> int:
    """Show the current source fingerprint vs the deployed install's, and whether
    they match. Network-free: it compares against the source tree this CLI runs from
    (`upgrade` is what pulls newer source from upstream)."""
    current = build.source_fingerprint()
    target = Path(args.target).expanduser().resolve() if args.target else build._opencode_config_dir()
    installed = build.read_version(target)
    if installed is None:                       # fall back to common bundle locations
        for base in (ROOT / "Harness", Path.cwd() / "Harness", Path.cwd()):
            v = build.read_version(base)
            if v:
                installed, target = v, base
                break
    print(f"[version] source:    {current}   ({ROOT})")
    print(f"[version] installed: {installed or '(none found)'}"
          + (f"   ({target})" if installed else ""))
    print(f"[version] {_version_verdict(installed, current)}")
    return 0


def _status_data() -> dict:
    """Gather everything the status dashboard reports — the single source for both the
    headless `status` command and the TUI panel, so the two never drift. Detects the
    installed theme/emit, counts agents/skills/laws, locates the memory store and
    counts facts, and compares the deployed version fingerprint to the source."""
    inst = _installed_defaults()
    theme = inst["theme"] or _default_theme()
    mdir = _resolve_memory_dir(None)
    inv = _tui_inventory(theme)
    try:
        cfg = build._opencode_config_dir()
    except Exception:
        cfg = None
    source_fp = build.source_fingerprint()
    installed_fp = ver_target = None
    candidates = ([cfg] if cfg else []) + [ROOT / "Harness", Path.cwd() / "Harness", Path.cwd()]
    for base in candidates:
        v = build.read_version(base)
        if v:
            installed_fp, ver_target = v, base
            break
    agent_md = (cfg / "AGENT.md") if (inst["emit"] == "opencode-global" and cfg) else None
    return {
        "theme": theme, "accent": _accent_for(theme), "emit": inst["emit"] or "—",
        "agents": len(inv["agents"]), "skills": len(inv["skills"]), "laws": len(inv["laws"]),
        "memory_dir": str(mdir) if mdir else None, "facts": len(_memory_facts(mdir)) if mdir else 0,
        "source_fp": source_fp, "installed_fp": installed_fp,
        "version_target": str(ver_target) if ver_target else None,
        "version_verdict": _version_verdict(installed_fp, source_fp),
        "agent_md": str(agent_md) if agent_md else None,
        "agent_md_present": bool(agent_md and agent_md.exists()),
    }


# Terminal escape-code map ({name: "31"}) — named _ANSI_CODES, not _ANSI, so it
# cannot be confused with build._ANSI, which maps the same names to bare ints for
# OpenCode theme slots.
_ANSI_CODES = {"red": "31", "green": "32", "yellow": "33", "blue": "34",
               "magenta": "35", "cyan": "36", "white": "37"}


def _color_enabled() -> bool:
    """ANSI only when writing to a real terminal and not muted by NO_COLOR / dumb."""
    return (sys.stdout.isatty() and os.environ.get("NO_COLOR") is None
            and os.environ.get("TERM") != "dumb")


def _status_lines(d: dict, color: bool = False) -> list[str]:
    """Render the status dashboard as a framed, aligned panel. Pure — returns the
    lines. `color` adds ANSI (accent frame + bold title, green/amber/dim verdict).
    GENESEED_TUI_ASCII swaps every non-ASCII glyph (box-drawing, ◆ · ✓ —) for a plain
    equivalent so fonts that tofu them still render and align."""
    asc = _TUI_ASCII
    H, V = ("-", "|") if asc else ("─", "│")
    TL, TR, BL, BR, LT, RT = (("+",) * 6 if asc else ("┌", "┐", "└", "┘", "├", "┤"))
    DOT = "-" if asc else "·"               # inline separator
    badge = "*" if asc else "◆"
    emdash = "-" if asc else "—"

    up = "up to date" in d["version_verdict"]
    none_inst = d["installed_fp"] is None
    mark = ("OK" if asc else "✓") if up else (("-" if asc else "·") if none_inst else "!")
    vcode = "32" if up else ("2" if none_inst else "33")

    rows = [
        ("theme", f"{d['theme']}  (accent: {d['accent']})"),
        ("install", d["emit"]),
        ("components", f"{d['agents']} agents {DOT} {d['skills']} skills {DOT} {d['laws']} laws"),
        ("memory", f"{d['memory_dir'] or '(not found)'}  "
                   f"({d['facts']} fact{'' if d['facts'] == 1 else 's'})"),
        ("version", f"{d['installed_fp'] or '(none)'}  {DOT}  source {d['source_fp']}"),
    ]
    if d["agent_md"]:
        rows.append(("AGENT.md",
                     f"{d['agent_md']}  ({'present' if d['agent_md_present'] else 'MISSING'})"))

    label_w = max(len(k) for k, _ in rows)
    body = [f"  {k.ljust(label_w)}   {v}" for k, v in rows]
    verdict = f"  {mark} {d['version_verdict']}"
    title = f" {badge} Geneseed {emdash} status "
    width = max([len(b) for b in body] + [len(verdict), len(title) + 2])

    ac = _ANSI_CODES.get(d["accent"], "36")

    def c(s: str, code: str) -> str:
        return f"\x1b[{code}m{s}\x1b[0m" if color else s

    top = (c(TL + H, ac) + c(title, f"{ac};1") + c(H * (width - len(title) - 1) + TR, ac)
           if color else TL + H + title + H * (width - len(title) - 1) + TR)
    edge = c(V, ac)
    lines = [top]
    lines += [edge + b.ljust(width) + edge for b in body]
    lines.append(c(LT + H * width + RT, ac))
    lines.append(edge + c(verdict.ljust(width), vcode) + edge)
    lines.append(c(BL + H * width + BR, ac))
    return lines


def cmd_status(args: argparse.Namespace) -> int:
    """Print the install dashboard — theme, install mode, component counts, memory
    store, version vs source, and (for a global install) AGENT.md — as a framed,
    aligned panel. The headless equivalent of the TUI status view, so Windows / CI /
    no-TTY hosts can see it too (color is auto-disabled when piped)."""
    for line in _status_lines(_status_data(), color=_color_enabled()):
        print(line)
    return 0
