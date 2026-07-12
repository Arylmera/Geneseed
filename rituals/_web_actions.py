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


# ---- user rules mutations ---------------------------------------------------------
# All writes to user-rules.md go through here (the Rules page). Every mutation
# requires the fingerprint of the content the client last read: an agent session may
# edit the same file mid-flight, and a stale write must 409 (the server maps
# ok=False to 409) and re-fetch, never silently clobber the agent's rule. Edits are
# line-range splices of one rule's block — the rest of the user's file, prose and
# formatting alike, is never regenerated.

def _rules_read(state: WebState) -> tuple[Path, str]:
    p = _rules_path(state)
    return p, (p.read_text(encoding="utf-8", errors="replace") if p.is_file() else "")


def _rules_fingerprint(text: str) -> str:
    import hashlib
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:16] if text else ""


def _rule_block(rid: int, title: str, scope: str, source: str,
                trial_until: str, body: str) -> str:
    meta = [f"scope: {scope}"]
    if source:
        meta.append(f"source: {source}")
    if trial_until:
        meta.append(f"trial until: {trial_until}")
    return f"## R{rid} — {title}\n({' | '.join(meta)})\n{body.strip()}\n"


def _rule_fields(body: dict) -> tuple[str, str, str, str, str]:
    """Validate and normalise the writable fields of a rule from a request body.
    Raises ValueError (→ JSON 500 with the message) on an unusable rule."""
    title = " ".join(str(body.get("title") or "").split())
    text = str(body.get("body") or "").strip()
    if not title:
        raise ValueError("a rule needs a title")
    if not text:
        raise ValueError("a rule needs body text")
    scope = body.get("scope")
    if scope not in ("user", "project"):
        scope = "project"
    source = " ".join(str(body.get("source") or "").split())
    trial = str(body.get("trial_until") or "").strip()
    if trial and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", trial):
        raise ValueError("trial until must be YYYY-MM-DD")
    return title, text, scope, source, trial


def api_rules_mutate(state: WebState, body: dict) -> dict:
    """One endpoint, three ops on user-rules.md: add (server assigns the next free
    R<n>), update (splice the block in place), delete (drop the block). Returns
    the fresh fingerprint so the client can chain edits without a re-fetch."""
    op = body.get("op")
    if op not in ("add", "update", "delete"):
        raise NotFound(f"rules op {op!r}")
    p, text = _rules_read(state)
    if body.get("fingerprint", "") != _rules_fingerprint(text):
        return {"ok": False, "error": "conflict",
                "detail": "user-rules.md changed since you loaded it — reloading"}
    rules, _warn = parse_rules(text)

    if op == "add":
        title, rtext, scope, source, trial = _rule_fields(body)
        rid = max((r["id"] for r in rules), default=0) + 1
        if not text:
            text = "# User rules\n"
        new = text.rstrip("\n") + "\n\n" + _rule_block(rid, title, scope, source,
                                                       trial, rtext)
    else:
        try:
            rid = int(body.get("id"))
        except (TypeError, ValueError):
            raise NotFound("rule id")
        target = next((r for r in rules if r["id"] == rid), None)
        if target is None:
            raise NotFound(f"rule R{rid}")
        lines = text.splitlines()
        if op == "update":
            title, rtext, scope, source, trial = _rule_fields(body)
            block = _rule_block(rid, title, scope, source, trial, rtext)
            lines[target["start"]:target["end"]] = block.rstrip("\n").splitlines()
        else:  # delete — also swallow one preceding blank separator line
            start = target["start"]
            if start > 0 and not lines[start - 1].strip():
                start -= 1
            del lines[start:target["end"]]
        new = "\n".join(lines).rstrip("\n") + "\n"

    p.write_text(new, encoding="utf-8")
    return {"ok": True, "op": op, "id": rid,
            "fingerprint": _rules_fingerprint(new)}


def api_profile_save(state: WebState, body: dict) -> dict:
    """Save the whole PROFILE.md from the editor. Fingerprint-guarded like the rules
    endpoint: a stale write (an agent edited the file since the client loaded it) 409s
    and re-fetches, never clobbers. Creates the file if the user deleted the seed."""
    import hashlib
    p = _profile_path(state)
    cur = p.read_text(encoding="utf-8", errors="replace") if p.is_file() else ""
    cur_fp = hashlib.sha256(cur.encode("utf-8")).hexdigest()[:16] if cur else ""
    if body.get("fingerprint", "") != cur_fp:
        return {"ok": False, "error": "conflict",
                "detail": "PROFILE.md changed since you loaded it — reloading"}
    new = str(body.get("text") or "")
    if new and not new.endswith("\n"):
        new += "\n"
    p.write_text(new, encoding="utf-8")
    return {"ok": True, "path": str(p),
            "fingerprint": hashlib.sha256(new.encode("utf-8")).hexdigest()[:16] if new else ""}


def api_rules_promote(state: WebState, body: dict) -> dict:
    """Promote one memory fact into a trial rule: append it to user-rules.md with
    provenance and a month of probation, then (opt-in) delete the source memory so
    the lesson is not loaded twice — the web twin of the rule skill's flow."""
    import datetime
    name = str(body.get("name") or "")
    d = _memory_dir(state)
    if not d.is_dir():
        raise NotFound("memory store")
    if not name or "/" in name or "\\" in name or name in ("MEMORY", "README"):
        raise NotFound(name)
    src = d / f"{name}.md"
    if not src.is_file():
        raise NotFound(name)
    fm, mem_body = harness._frontmatter(src.read_text(encoding="utf-8",
                                                      errors="replace"))
    today = datetime.date.today()
    res = api_rules_mutate(state, {
        "op": "add",
        "fingerprint": body.get("fingerprint", ""),
        "title": body.get("title") or fm.get("name", name),
        "body": body.get("body") or mem_body.strip() or fm.get("description", ""),
        "scope": body.get("scope"),
        "source": f"memory {name}, promoted {today.isoformat()}",
        "trial_until": (today + datetime.timedelta(days=30)).isoformat(),
    })
    if res.get("ok") and body.get("delete_memory"):
        api_memory_delete(state, name)
        res["deleted_memory"] = name
    return res


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
    target, theme, files = harness._diff_collect(target=state.target, theme=state.theme,
                                                 emit=state.emit)
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
        # Render the EXPECTED copy with the deployed install's OWN host emit, so a
        # restore renders the right dialect (Claude/Bob agents, not a silently-OpenCode
        # expected that would overwrite them with the wrong frontmatter / delete them).
        emitter = _global_emitter_for(state.emit)
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
    """MCP servers per ACTIVE install — the web mirror of the TUI's MCP screen, now
    host-aware. Each target is one active install's MCP config (OpenCode's opencode.json,
    or Claude's .mcp.json / ~/.claude.json); the harness table joins it to its row by
    (host, root). Presets first, then any user-defined server already in the config. An
    absent/disabled install has no live config to wire, so it contributes no target."""
    targets = [t for t in harness._mcp_install_targets()
               if harness._install_state(t[4], t[2], t[3]) == "active"]
    out = []
    for label, path, host, _scope, root in targets:
        cfg = harness._mcp_load(path, host)
        servers = []
        for name in harness._mcp_known_names(cfg, host):
            lbl, desc = harness._mcp_meta(name)
            servers.append({"name": name, "label": lbl, "desc": desc,
                            "preset": name in harness._MCP_PRESETS,
                            "state": harness._mcp_state(cfg, name, host)})
        out.append({"label": label, "path": str(path), "host": host, "root": str(root),
                    "exists": path.is_file(), "commented": harness._mcp_commented(path),
                    "servers": servers})
    # `default` is kept for response-shape stability; the table nests MCP per install and
    # no longer opens on a single target, so the value is unused by the UI.
    return {"targets": out, "default": 0}


def api_mcp_toggle(state: WebState, body: dict) -> dict:
    """Enable/disable — or first-add a preset — MCP server `name` in the config at `path`.
    Host-aware: OpenCode flips the server's `enabled` flag (non-destructive); Claude's
    .mcp.json has no such flag, so toggling a server off REMOVES its entry (re-add to
    restore). A hand-commented opencode.jsonc is refused, and a Claude config that does
    not parse is refused rather than clobbered — it may be the large ~/.claude.json that
    holds far more than MCP wiring."""
    name = str(body.get("name") or "")
    want = bool(body.get("enabled"))
    path_arg = str(body.get("path") or "")
    known = {str(cfg): (cfg, host) for _l, cfg, host, _s, _r in harness._mcp_install_targets()}
    hit = known.get(path_arg)
    if hit is None or not name:
        raise NotFound(f"mcp target {path_arg or '(none)'}")
    path, host = hit
    if harness._mcp_commented(path):
        return {"ok": False,
                "error": "config holds comments — edit it by hand to keep them"}
    if host in ("claude", "bob", "copilot"):
        # Claude, Bob AND Copilot configs are strict JSON. Parse ONCE, strictly, and
        # rewrite THAT exact dict — so the safety check and the value we save come from
        # the same read (no parser-mismatch, no time-of-check/time-of-use gap) and a
        # string value containing ',]' / ', }' is never mangled by the comment-stripper's
        # trailing-comma pass. Refuse an existing file we cannot parse rather than clobber
        # it: it may be ~/.claude.json (projects/history), Bob's settings.json
        # (hooks/permissions far beyond MCP wiring) or Copilot's mcp-config.json.
        if path.is_file():
            try:
                cfg = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                cfg = None
            if not isinstance(cfg, dict):
                return {"ok": False,
                        "error": "couldn't parse this config — edit it by hand to avoid data loss"}
        else:
            cfg = {}
    else:
        cfg = harness._mcp_load(path)
    current = harness._mcp_state(cfg, name, host)
    if current == "absent":
        if name not in harness._MCP_PRESETS:
            return {"ok": False, "error": f"unknown server '{name}'"}
        if not want:
            return {"ok": False, "error": f"'{name}' is not configured"}
        cfg = harness._mcp_apply(cfg, name, harness._mcp_preset_block(name, host), host)
        cfg = harness._mcp_set_enabled(cfg, name, True, host)
    else:
        cfg = harness._mcp_set_enabled(cfg, name, want, host)
    harness._mcp_save(path, cfg)
    return {"ok": True, "name": name, "state": harness._mcp_state(cfg, name, host)}


def api_installs(state: WebState) -> dict:
    """Detected installs across host x scope and their on/off state. One row per
    (host, scope, path) tuple — see harness._install_targets. Both OpenCode and Claude,
    global and per-repo, are listed so the dashboard can manage them in parallel."""
    out = []
    cur = state.target.resolve()
    for host, scope, root in harness._install_targets():
        out.append({"id": f"{host}:{scope}", "host": host, "scope": scope,
                    "path": str(root), "state": harness._install_state(root, host, scope),
                    "theme": harness._theme_of_dir(root),   # the install's own voice (None if absent)
                    # Footprint marker lands at the install root (== build --out) for every
                    # emit — same dir theme reads from, so detect it the same way.
                    "footprint": harness._footprint_of_dir(root),   # 'full' when no marker
                    "posture": harness._posture_of_dir(root),   # the install's register (None if absent)
                    "selected": _view_cfg(host, scope, root).resolve() == cur})
    # `postures` lets the Harnesses page render the per-row register picker without a
    # second call — discovered from src/, so a new posture appears with no UI change.
    return {"installs": out, "postures": build.posture_names()}


def _view_cfg(host: str, scope: str, root) -> Path:
    """The data dir to read an install's inventory/memory/diff from. Global installs (and
    the OpenCode per-repo bundle) keep it at the root; a Claude, Bob OR Copilot per-repo
    install keeps it under its marker dir (<repo>/.claude, <repo>/.bob, <repo>/.github) —
    host-driven so a new nested-marker host can't silently read the bare root."""
    if scope == "project" and host in ("claude", "bob", "copilot"):
        return root / build.HOSTS[host]["project_marker"]
    return root


def _global_emitter_for(emit: "str | None"):
    """The global emit fn matching a deployed install's `.geneseed-emit` value, so the
    'expected' render (restore/diff) uses the install's OWN host dialect. Falls back to
    the OpenCode global emit for an unknown/missing marker."""
    host = harness._EMIT_HOST_SCOPE.get(emit or "", ("opencode", "global"))[0]
    return build.HOSTS.get(host, build.HOSTS["opencode"])["emit_global"]


def api_select_view(state: WebState, body: dict) -> dict:
    """Re-point the whole console at a detected install (the harness selector). The
    (host, path) pair MUST be one of the detected targets; state.target/theme/emit are
    re-pointed to the install's data dir so the next overview/catalog/diff GET reflects
    it. Raises NotFound for an unknown pair."""
    known = {(h, str(r)): (h, s, r) for h, s, r in harness._install_targets()}
    hit = known.get((body.get("host") or "", body.get("path") or ""))
    if hit is None:
        raise NotFound("unknown install (host, path)")
    host, scope, root = hit
    # Thread the install ROOT through: markers/sigils live there, not in the data
    # dir — without it a claude/bob project view mis-detects as opencode/neutral.
    state.select_view(_view_cfg(host, scope, root), root=root)
    return {"ok": True, "target": str(state.target), "theme": state.theme, "emit": state.emit}


_EMIT_FOR = {
    ("opencode", "global"): "opencode-global", ("opencode", "project"): "opencode",
    ("claude", "global"): "claude-global", ("claude", "project"): "claude",
    ("bob", "global"): "bob-global", ("bob", "project"): "bob",
    ("copilot", "global"): "copilot-global", ("copilot", "project"): "copilot",
}


def api_install_cmd(state: WebState, body: dict) -> dict:
    """Resolve the build command that installs Geneseed into a detected location, or
    re-themes an already-active one (an in-place re-emit — same build command either way).
    The (host, path) pair MUST be one of the detected install targets — mirrors
    api_install_toggle's allowlist, so the target is never built from raw body input — and
    it must not be `disabled` (reactivate first). The voice is the picked theme if valid,
    else the current deployed voice; a per-repo install lands under the row's own path.
    Returns {"cmd": [...]} for the job runner, or {"error": ...}; raises NotFound for an
    unknown (host, path)."""
    known = {(host, str(r)): (host, scope, r)
             for host, scope, r in harness._install_targets()}
    hit = known.get((body.get("host") or "", body.get("path") or ""))
    if hit is None:
        raise NotFound("unknown install (host, path)")
    host, scope, root = hit
    if harness._install_state(root, host, scope) == "disabled":
        return {"error": "install is disabled — reactivate it before (re)building"}
    emit = _EMIT_FOR.get((host, scope))
    if emit is None:
        return {"error": f"no install mode for {host}:{scope}"}
    # The new install's voice: a valid picked theme wins, else the current deployed
    # voice — so a bogus body value can never reach the build argv (mirrors _build_override).
    themes = {c["name"] for c in _theme_choices()}
    theme = body.get("theme") if body.get("theme") in themes else state.theme
    # Footprint: a valid pick wins, else keep the install's own — so a re-theme never
    # silently flips footprint, and a bogus body value can't reach the argv.
    fp = body.get("footprint")
    fp = fp if fp in ("lean", "full") else harness._footprint_of_dir(root)
    # Posture: same rule — a valid picked register wins, else keep the install's own, so a
    # re-theme never resets the register and a bogus body value can't reach the argv.
    pos = body.get("posture")
    pos = pos if pos in build.posture_names() else (harness._posture_of_dir(root) or "peer")
    out = None if scope == "global" else str(root)
    argv = harness._setup_build_args(theme or "neutral", emit, out, out, fp, pos)
    return {"cmd": [sys.executable, str(ROOT / "build.py"), *argv]}


def api_deploy_cmd(state: WebState, body: dict) -> dict:
    """Resolve the build command that deploys a FRESH per-repo harness into an arbitrary
    folder the user chose — the open-ended sibling of api_install_cmd (which only
    (re)builds a pre-detected target from a tight allowlist). Scope is always 'project':
    a global lands in the host's config dir, never a chosen folder. The path is validated
    here as an existing, writable directory (this endpoint takes a raw path, so it's the
    trust boundary); host must be known; voice is a valid picked theme else the current
    one. The deploy records its root in the registry (build.py choke point), so the new
    harness then appears in the installs list. Returns {"cmd": [...]} or {"error": ...}."""
    host = (body.get("host") or "").strip()
    if host not in build.HOSTS:
        return {"error": f"unknown host: {host or '(none)'}"}
    raw = (body.get("path") or "").strip()
    if not raw:
        return {"error": "no folder given"}
    root = Path(raw).expanduser()
    try:
        root = root.resolve()
    except OSError:
        return {"error": f"bad path: {raw}"}
    if not root.is_dir():
        return {"error": f"not a folder: {root}"}
    if not os.access(root, os.W_OK):
        return {"error": f"folder not writable: {root}"}
    # A host's own global config dir isn't a per-repo deploy target — deploying a
    # 'project' emit there would mislabel as the global row (dedup collision). Send the
    # user to the existing global row instead.
    cfgdirs = set()
    for cfgfn in (build._opencode_config_dir, build._claude_config_dir,
                  build._bob_config_dir, build._copilot_config_dir):
        try:
            cfgdirs.add(cfgfn().resolve())
        except Exception:
            pass
    if root in cfgdirs:
        return {"error": "that's a host global config dir — use its existing row to build a global install"}
    themes = {c["name"] for c in _theme_choices()}
    theme = body.get("theme") if body.get("theme") in themes else state.theme
    fp = body.get("footprint")
    fp = fp if fp in ("lean", "full") else "full"   # a fresh deploy defaults to full
    pos = body.get("posture")
    pos = pos if pos in build.posture_names() else "peer"   # a fresh deploy defaults to peer
    emit = host   # project-scope emit name == host name (opencode / claude / bob / copilot)
    argv = harness._setup_build_args(theme or "neutral", emit, str(root), str(root), fp, pos)
    return {"cmd": [sys.executable, str(ROOT / "build.py"), *argv]}


def api_pick_folder(state: WebState | None = None, body: dict | None = None) -> dict:
    """Open the OS-native folder chooser ON THE DAEMON HOST and return the picked
    absolute path. For a local console the daemon shares the user's screen, so this IS a
    native picker — a browser can't reveal a disk path itself. macOS: osascript `choose
    folder` (a StandardAdditions command — runs in-process, no automation-consent
    prompt). Else: a one-shot tkinter askdirectory subprocess (kept off the server thread).
    Returns {"path": ...} | {"cancelled": True} | {"error": ...}; on error (e.g. a headless
    daemon with no GUI session) the UI falls back to its editable path field."""
    import subprocess
    if sys.platform == "darwin":
        osa = ('set f to POSIX path of (choose folder with prompt '
               '"Choose a folder to deploy the harness into")\nreturn f')
        try:
            r = subprocess.run(["osascript", "-e", osa],
                               capture_output=True, text=True, timeout=300)
        except (OSError, subprocess.SubprocessError) as e:
            return {"error": f"folder picker unavailable: {e}"}
        if r.returncode == 0:
            return {"path": r.stdout.strip()}
        err = (r.stderr or "").strip()
        if "-128" in err or "User canceled" in err:
            return {"cancelled": True}
        return {"error": err or "folder picker failed"}
    code = ("import tkinter, tkinter.filedialog as fd\n"
            "r = tkinter.Tk(); r.withdraw()\n"
            "print(fd.askdirectory(title='Choose a folder to deploy the harness into') or '')\n")
    try:
        r = subprocess.run([sys.executable, "-c", code],
                           capture_output=True, text=True, timeout=300,
                           **harness.NO_WINDOW)
    except (OSError, subprocess.SubprocessError) as e:
        return {"error": f"folder picker unavailable: {e}"}
    if r.returncode != 0:
        # tkinter failed to even open (no $DISPLAY on a headless/SSH daemon, or no
        # python3-tk). Surface it as an error so the UI keeps its editable path field —
        # NOT a silent {cancelled} no-op. (askdirectory returns '' on a real cancel.)
        lines = (r.stderr or "").strip().splitlines()
        return {"error": lines[-1] if lines else "folder picker unavailable"}
    picked = (r.stdout or "").strip()
    return {"path": picked} if picked else {"cancelled": True}


def api_install_toggle(state: WebState, body: dict) -> dict:
    """Deactivate, reactivate, or REMOVE one install. Deactivate/activate are
    non-destructive (files move aside); `remove` deletes the harness from the folder and
    de-lists it (memory disposition via `memory`). Keyed on the (host, path) PAIR — a cwd
    can carry both an OpenCode and a Claude install at the same path, so path alone is
    ambiguous; and the pair MUST be one of the detected installs, else 404 (this endpoint
    moves/deletes whole trees — never build the root from raw body input)."""
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
    elif action == "remove":
        # Destructive: delete the harness from the folder and de-list it. `memory` ∈
        # {keep, archive, delete} governs the memory/notebook stores (validated in the
        # engine; an unknown value falls back to keep, never a surprise delete).
        res = harness._install_uninstall(root, host, scope, body.get("memory") or "keep")
    else:
        res = {"ok": False, "error": f"unknown action {action!r}"}
    state.refresh()
    return res
