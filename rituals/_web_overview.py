"""Geneseed web — the dashboard overview aggregate.

Part of the web API (see web.py). Imports the shared toolset from _web_core."""
from __future__ import annotations

from _web_core import *  # noqa: F401,F403  shared stdlib + primitives


def api_overview(state: WebState) -> dict:
    inv = state.inventory
    diff = None
    if _deployed(state):
        _t, _th, files = harness._diff_collect(target=state.target, theme=state.theme)
        if files is not None:
            diff = {
                "edited": sum(1 for f in files if f["status"] == "edited"),
                "added": sum(1 for f in files if f["status"] == "added"),
                "missing": sum(1 for f in files if f["status"] == "missing"),
            }
    build_time = None
    agent_md = state.target / "AGENT.md"
    if agent_md.is_file():
        import datetime
        build_time = datetime.datetime.fromtimestamp(
            agent_md.stat().st_mtime).strftime("%Y-%m-%d %H:%M")
    # Identify which detected install the current view points at, so the dashboard's
    # footprint hero can re-emit exactly it (host/scope/path) and read its footprint
    # from the install root. Mirrors _web_actions._view_cfg's rule: a project claude/bob
    # install keeps its data under the marker dir; everything else sits at the root.
    cur = state.target.resolve()
    install = None
    for host, scope, root in harness._install_targets():
        data = (root / build.HOSTS[host]["project_marker"]
                if scope == "project" and host in ("claude", "bob") else root)
        try:
            if data.resolve() == cur:
                install = {"host": host, "scope": scope, "path": str(root),
                           "footprint": harness._footprint_of_dir(root)}
                break
        except OSError:
            pass
    return {
        "theme": state.theme,
        "accent": harness._accent_for(state.theme),
        "emit": state.emit,
        "footprint": install["footprint"] if install else state.footprint,
        "install": install,   # {host,scope,path,footprint} of the current view, or None
        "target": str(state.target),
        "deployed": _deployed(state),
        "counts": {
            "agents": len(inv["agents"]),
            "skills": len(inv["skills"]),
            "laws": len(inv["laws"]),
            "memory": len(_memory_items(state)),
            "notebook": len(_notebook_items(state)),
            "wiki": len(_wiki_items(state)),
            "config": len(_config_items(state)),
        },
        "doctor": state.doctor,
        "diff": diff,
        "build_time": build_time,
    }

