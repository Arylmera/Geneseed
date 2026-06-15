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
    return {
        "theme": state.theme,
        "accent": harness._accent_for(state.theme),
        "emit": state.emit,
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

