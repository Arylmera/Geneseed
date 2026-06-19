"""Geneseed web — mutating/snapshot actions: themes, doctor, setup, diff,
restore, mcp toggles, memory delete.

Part of the web API (see web.py). Imports the shared toolset from _web_core."""
from __future__ import annotations

from _web_core import *  # noqa: F401,F403  shared stdlib + primitives


def _theme_choices() -> list[dict]:
    """Available themes — name + blurb from the option list, plus the accent,
    tagline and loaded-sigil each theme's JSON declares (for the web gallery)."""
    out = []
    for name, blurb in harness._theme_options():
        try:
            data = json.loads(
                (build.THEMES / f"{name}.json").read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            data = {}
        out.append({"name": name, "blurb": blurb,
                    "accent": data.get("ACCENT", "cyan"),
                    "tagline": data.get("TAGLINE", ""),
                    "sigil": data.get("LOADED_SIGIL", "")})
    return out


def _emit_choices() -> list[dict]:
    """Available install modes (name + description) — the setup wizard's options."""
    return [{"name": name, "desc": desc} for name, desc in harness.EMIT_OPTIONS]


def api_themes(state: WebState) -> dict:
    """Theme + emit options for the web Build picker, plus the detected current pair."""
    return {"themes": _theme_choices(), "emits": _emit_choices(),
            "current": {"theme": state.theme, "emit": state.emit}}


def _build_override(state: WebState, body: dict) -> tuple:
    """Resolve (theme, emit) for a Build POST: a valid override in the request body
    wins; anything missing or unrecognised falls back to the detected install — so a
    bogus value can never reach the build argv."""
    themes = {c["name"] for c in _theme_choices()}
    emits = {c["name"] for c in _emit_choices()}
    t, e = body.get("theme"), body.get("emit")
    return (t if t in themes else state.theme,
            e if e in emits else state.emit)


def api_doctor(state: WebState) -> dict:
    """Doctor checks, grouped per check, for the web Doctor page — the same engine
    as the `doctor` command (_doctor_collect fills `groups` as it runs). A run
    here also refreshes the overview's cached verdict."""
    groups: list[dict] = []
    themes, problems = harness._doctor_collect(theme=state.theme, groups=groups)
    state.stamp_doctor(problems)
    return {"themes": themes, "ok": not problems,
            "problems": problems, "groups": groups,
            "checked_at": state.doctor["checked_at"]}


def api_memory_delete(state: WebState, name: str) -> dict:
    """Delete one memory fact and drop its line from MEMORY.md (the index the
    agent reads at session start). `name` is the bare slug; a path-separator or
    the reserved index/readme names are rejected, so this can only ever remove a
    fact file inside the resolved memory dir — never an arbitrary path."""
    d = _memory_dir(state)
    if not d.is_dir():
        raise NotFound("memory store")
    if not name or "/" in name or "\\" in name or name in ("MEMORY", "README"):
        raise NotFound(name)
    p = d / f"{name}.md"
    if not p.is_file():
        raise NotFound(name)
    p.unlink()
    harness._memory_drop_index(d, name)
    state.refresh()
    return {"deleted": name}


def api_setup(state: WebState) -> dict:
    """Install snapshot for the Settings page — harness._status_data() (the same
    source the `status` command and the TUI panel read, so the three never drift)
    plus the web server's own facts."""
    d = harness._status_data()
    d.update({
        "root": str(ROOT),
        "target": str(state.target),
        "deployed": _deployed(state),
        "python": sys.version.split()[0],
    })
    return d


def api_diff(state: WebState) -> dict:
    target, theme, files = harness._diff_collect(target=state.target, theme=state.theme)
    return {
        "deployed": files is not None,
        "target": str(target),
        "theme": theme,
        "files": files or [],
    }


def api_restore(state: WebState, files: list) -> dict:
    """Restore selected drifted files from the source render — source wins, local
    edits are discarded (the inverse, keeping them, is Export improvements).
    Renders the expected copy exactly as _diff_collect does, then per rel:
    expected file present -> overwrite/create the deployed copy; expected absent
    but deployed present (an 'added' file) -> delete the deployed copy. Unknown
    or out-of-tree paths land in errors and touch nothing."""
    if not _deployed(state):
        return {"restored": [], "deleted": [], "errors": ["no deployed harness"]}
    restored, deleted, errors = [], [], []
    target = state.target.resolve()
    with tempfile.TemporaryDirectory() as tmp:
        expected = (Path(tmp) / "expected").resolve()
        # Render the EXPECTED copy with the deployed install's own host emit, so a
        # restore on a Claude row renders Claude (not a silently-OpenCode expected).
        emitter = (build.emit_claude_global if (state.emit or "").startswith("claude")
                   else build.emit_opencode_global)
        with contextlib.redirect_stdout(io.StringIO()):   # swallow the emit's own log
            emitter(state.theme, out=Path(tmp) / "bundle", cfg=expected)
        for rel in files or []:
            rel = str(rel).replace("\\", "/").strip().lstrip("/")
            dst = (target / rel).resolve()
            src = (expected / rel).resolve()
            if not rel or not harness._within(dst, target) \
                    or not harness._within(src, expected):
                errors.append(f"{rel}: outside the deployed tree")
                continue
            if src.is_file():
                dst.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(src, dst)
                restored.append(rel)
            elif dst.is_file():
                dst.unlink()
                deleted.append(rel)
            else:
                errors.append(f"{rel}: not in the source render nor deployed")
    state.refresh()
    return {"restored": restored, "deleted": deleted, "errors": errors}


def api_mcp(state: WebState) -> dict:
    """MCP servers per config target — the web mirror of the TUI's MCP screen.
    Presets first, then user-defined servers present in each config."""
    # Only show MCP wiring for harnesses that are actually installed and active —
    # an absent/disabled install has no live config to wire. MCP is OpenCode-only, so
    # gate each mcp target on its OWN root's OpenCode install state (root = the config
    # file's parent dir).
    targets = [(l, p) for l, p in harness._mcp_targets()
               if harness._install_state(p.parent, "opencode") == "active"]
    out = []
    for label, path in targets:
        cfg = harness._mcp_load(path)
        servers = []
        for name in harness._mcp_known_names(cfg):
            lbl, desc = harness._mcp_meta(name)
            servers.append({"name": name, "label": lbl, "desc": desc,
                            "preset": name in harness._MCP_PRESETS,
                            "state": harness._mcp_state(cfg, name)})
        out.append({"label": label, "path": str(path), "exists": path.is_file(),
                    "commented": harness._mcp_commented(path),
                    "servers": servers})
    return {"targets": out, "default": harness._mcp_default_target(targets)}


def api_mcp_toggle(state: WebState, body: dict) -> dict:
    """Enable/disable — or first-add a preset — MCP server `name` in the target
    config at `path`. Same non-destructive rewrite as the TUI (only the mcp
    block changes); a hand-commented .jsonc is refused, never rewritten."""
    name = str(body.get("name") or "")
    want = bool(body.get("enabled"))
    path_arg = str(body.get("path") or "")
    known = {str(p): p for _label, p in harness._mcp_targets()}
    path = known.get(path_arg)
    if path is None or not name:
        raise NotFound(f"mcp target {path_arg or '(none)'}")
    if harness._mcp_commented(path):
        return {"ok": False,
                "error": "config holds comments — edit it by hand to keep them"}
    cfg = harness._mcp_load(path)
    current = harness._mcp_state(cfg, name)
    if current == "absent":
        preset = harness._MCP_PRESETS.get(name)
        if preset is None:
            return {"ok": False, "error": f"unknown server '{name}'"}
        if not want:
            return {"ok": False, "error": f"'{name}' is not configured"}
        cfg = harness._mcp_apply(cfg, name, dict(preset["block"]))
        cfg = harness._mcp_set_enabled(cfg, name, True)
    else:
        cfg = harness._mcp_set_enabled(cfg, name, want)
    harness._mcp_save(path, cfg)
    return {"ok": True, "name": name, "state": harness._mcp_state(cfg, name)}


def api_installs(state: WebState) -> dict:
    """Detected installs across host x scope and their on/off state. One row per
    (host, scope, path) tuple — see harness._install_targets. Both OpenCode and Claude,
    global and per-repo, are listed so the dashboard can manage them in parallel."""
    out = []
    for host, scope, root in harness._install_targets():
        out.append({"id": f"{host}:{scope}", "host": host, "scope": scope,
                    "path": str(root), "state": harness._install_state(root, host, scope)})
    return {"installs": out}


def api_install_toggle(state: WebState, body: dict) -> dict:
    """Deactivate or reactivate one install. Non-destructive. Keyed on the
    (host, path) PAIR — a cwd can carry both an OpenCode and a Claude install at the
    same path, so path alone is ambiguous; and the pair MUST be one of the detected
    installs, else 404 (this endpoint moves whole trees — never build the root from raw
    body input)."""
    known = {(host, str(r)): (host, scope, r)
             for host, scope, r in harness._install_targets()}
    hit = known.get((body.get("host") or "", body.get("path") or ""))
    if hit is None:
        raise NotFound("unknown install (host, path)")
    host, scope, root = hit
    action = body.get("action")
    if action == "deactivate":
        res = harness._install_deactivate(root, host, scope)
    elif action == "activate":
        res = harness._install_reactivate(root, host, scope)
    else:
        res = {"ok": False, "error": f"unknown action {action!r}"}
    state.refresh()
    return res
