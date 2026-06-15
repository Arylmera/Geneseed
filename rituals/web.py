#!/usr/bin/env python3
"""Geneseed web UI — local, dependency-free HTTP server over the deployed Harness.

Pure API functions (api_overview/api_catalog/api_item/api_diff) are unit-tested
without sockets; the HTTP handler is a thin JSON shell around them. Mutating
actions run as background subprocess jobs (fire-and-notify). Reuses harness.py
and build.py for every read so the web and TUI never disagree.

web.py is a thin facade: it owns no logic, only the import-time wiring. Each
concern lives in its own _web_<topic>.py. The file was one flat module whose
functions call freely across what are now file boundaries, so after importing
the submodules we link them into ONE shared namespace — every name visible to
every submodule and to this facade, exactly as when it was a single file. This
keeps the CLI / TUI and the `import web` surface (tests, _harness_tui, _update,
_harness_menu) byte-for-byte unchanged. Mirrors harness.py's own layout.
"""
from __future__ import annotations

import _web_core
import _web_catalog
import _web_jobs
import _web_actions
import _web_graph
import _web_docs
import _web_overview
import _web_server

_SUBMODULES = (
    _web_core,
    _web_catalog,
    _web_jobs,
    _web_actions,
    _web_graph,
    _web_docs,
    _web_overview,
    _web_server,
)
_SHARED = {}
for _m in _SUBMODULES:
    _SHARED.update({k: v for k, v in vars(_m).items() if not k.startswith("__")})
for _m in _SUBMODULES:
    vars(_m).update(_SHARED)
globals().update(_SHARED)
del _m
