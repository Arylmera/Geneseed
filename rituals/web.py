#!/usr/bin/env python3
"""Geneseed web UI — local, dependency-free HTTP server over the deployed Harness.

Pure API functions (api_overview/api_catalog/api_item/api_diff) are unit-tested
without sockets; the HTTP handler is a thin JSON shell around them. Mutating
actions run as background subprocess jobs (fire-and-notify). Reuses harness.py
and build.py for every read so the web and TUI never disagree.
"""
from __future__ import annotations

import contextlib
import io
import json
import re
import zipfile
import secrets
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import build          # noqa: E402
import harness        # noqa: E402

SECTIONS = ("agents", "skills", "laws", "memory", "notebook", "config")
WIKILINK_RE = re.compile(r"\[\[([^\]]+)\]\]")


class NotFound(Exception):
    """Requested catalog section or item does not exist."""


class WebState:
    """Resolved view of the deployed harness the server reads from. Inventory is
    rendered once per process (cheap, pure) and cached; actions that mutate the
    harness clear it via refresh()."""

    def __init__(self, theme: str | None = None, target: Path | None = None):
        self.target = Path(target) if target else build._opencode_config_dir()
        self.theme = theme or harness._theme_of_dir(self.target) or "neutral"
        # Detect the install mode once, so the Build action rebuilds the deployed
        # harness in place (e.g. opencode-global) rather than a bare source render.
        self.emit = harness._installed_defaults().get("emit") or "opencode-global"
        self._inv = None

    @property
    def inventory(self) -> dict:
        if self._inv is None:
            self._inv = harness._tui_inventory(self.theme)
        return self._inv

    def refresh(self):
        """Drop caches and re-detect the deployed theme/emit — a finished Build may
        have re-themed the install, and the gallery's 'current' must follow it."""
        self._inv = None
        self.theme = harness._theme_of_dir(self.target) or self.theme
        self.emit = harness._installed_defaults().get("emit") or self.emit


def _deployed(state: WebState) -> bool:
    return (state.target / build.GLOBAL_MANIFEST).exists()


def _memory_items(state: WebState) -> list[dict]:
    d = harness._resolve_memory_dir(None)
    if not d or not d.is_dir():
        return []
    out = []
    for p in sorted(d.glob("*.md")):
        fm, _body = harness._frontmatter(p.read_text(encoding="utf-8", errors="replace"))
        out.append({"name": p.stem,
                    "title": fm.get("name", p.stem),
                    "desc": fm.get("description", "")})
    return out


def _notebook_items(state: WebState) -> list[dict]:
    d = state.target / "notebook"
    if not d.is_dir():
        return []
    return [{"name": p.stem, "title": p.stem, "desc": ""}
            for p in sorted(d.glob("*.md"))]


def _config_items(state: WebState) -> list[dict]:
    out = []
    for fname in ("context.json", "wiki.jsonc"):
        if (state.target / fname).is_file():
            out.append({"name": fname, "title": fname, "desc": ""})
    return out


def api_catalog(state: WebState, section: str) -> dict:
    if section not in SECTIONS:
        raise NotFound(section)
    inv = state.inventory
    if section in ("agents", "skills"):
        items = [{"name": e["name"], "title": e["name"], "desc": e["desc"]}
                 for e in inv[section]]
    elif section == "laws":
        items = [{"name": e["num"], "title": f"Rule {e['num']} — {e['title']}",
                  "desc": ""} for e in inv["laws"]]
    elif section == "memory":
        items = _memory_items(state)
    elif section == "notebook":
        items = _notebook_items(state)
    else:  # config
        items = _config_items(state)
    return {"section": section, "items": items}


def _resolve_links(state: WebState, body: str) -> list[dict]:
    """Cross-references found in body, resolved to nav targets. Matches [[name]]
    wikilinks against known agent/skill names."""
    inv = state.inventory
    known = {}  # name -> "agent" | "skill"
    for e in inv["agents"]:
        known[e["name"]] = "agent"
    for e in inv["skills"]:
        known[e["name"]] = "skill"
    links, seen = [], set()
    for m in WIKILINK_RE.finditer(body):
        label = m.group(1).strip()
        if label in known and label not in seen:
            seen.add(label)
            links.append({"label": label, "type": known[label], "name": label})
    return links


def api_item(state: WebState, type_: str, name: str) -> dict:
    inv = state.inventory
    if type_ == "agent":
        e = next((x for x in inv["agents"] if x["name"] == name), None)
        if not e:
            raise NotFound(name)
        return {"type": type_, "name": name, "title": name, "desc": e["desc"],
                "body": e["body"], "links": _resolve_links(state, e["body"])}
    if type_ == "skill":
        e = next((x for x in inv["skills"] if x["name"] == name), None)
        if not e:
            raise NotFound(name)
        return {"type": type_, "name": name, "title": name, "desc": e["desc"],
                "body": e["body"], "links": _resolve_links(state, e["body"])}
    if type_ == "law":
        e = next((x for x in inv["laws"] if x["num"] == name), None)
        if not e:
            raise NotFound(name)
        return {"type": type_, "name": name, "title": f"Rule {e['num']} — {e['title']}",
                "desc": "", "body": e["body"], "links": []}
    if type_ in ("memory", "notebook"):
        d = (state.target / "notebook") if type_ == "notebook" \
            else harness._resolve_memory_dir(None)
        p = (d / f"{name}.md") if d else None
        if not p or not p.is_file():
            raise NotFound(name)
        body = p.read_text(encoding="utf-8", errors="replace")
        return {"type": type_, "name": name, "title": name, "desc": "",
                "body": body, "links": _resolve_links(state, body)}
    if type_ == "config":
        p = state.target / name
        if not p.is_file():
            raise NotFound(name)
        raw = p.read_text(encoding="utf-8", errors="replace")
        return {"type": type_, "name": name, "title": name, "desc": "",
                "body": f"```json\n{raw}\n```", "links": []}
    raise NotFound(type_)


class JobManager:
    """Runs one mutating action at a time in a background thread, capturing
    combined stdout/stderr. A second start() while busy returns None (the HTTP
    layer maps that to 409). Jobs are in-memory and do not survive restart."""

    def __init__(self):
        self._lock = threading.Lock()
        self._jobs: dict[str, dict] = {}
        self._busy = False

    def start(self, action: str, *cmds: list, on_done=None) -> "str | None":
        with self._lock:
            if self._busy:
                return None
            self._busy = True
            jid = secrets.token_hex(8)
            self._jobs[jid] = {"id": jid, "action": action, "status": "running",
                               "output": "", "returncode": None}
        t = threading.Thread(target=self._run, args=(jid, cmds, on_done), daemon=True)
        t.start()
        return jid

    def _append(self, jid: str, text: str):
        with self._lock:
            self._jobs[jid]["output"] += text

    def _run(self, jid: str, cmds, on_done=None):
        rc = 0
        try:
            for cmd in cmds:
                self._append(jid, f"$ {' '.join(str(c) for c in cmd)}\n")
                # Stream combined stdout/stderr line-by-line so the web console
                # fills live (terminal-style) instead of dumping at the end.
                p = subprocess.Popen(
                    cmd, cwd=str(ROOT), stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT, text=True,
                    encoding="utf-8", errors="replace", bufsize=1)
                for line in p.stdout:
                    self._append(jid, line)
                p.wait()
                rc = p.returncode
                if rc != 0:
                    break
        except Exception as e:  # noqa: BLE001
            self._append(jid, f"\n[web] job crashed: {e}")
            rc = 1
        finally:
            with self._lock:
                self._jobs[jid].update(
                    status="done" if rc == 0 else "failed", returncode=rc)
                self._busy = False
            if on_done:
                try:
                    on_done()
                except Exception:  # noqa: BLE001 — refresh must never kill the job thread
                    pass

    def get(self, jid: str) -> "dict | None":
        with self._lock:
            j = self._jobs.get(jid)
            return dict(j) if j else None

    def wait(self, jid: str, timeout: float = 30.0) -> dict:
        deadline = time.time() + timeout
        while time.time() < deadline:
            j = self.get(jid)
            if j and j["status"] != "running":
                return j
            time.sleep(0.05)
        return self.get(jid)


def action_commands(action: str, theme: str = "neutral",
                    emit: str = "opencode-global") -> "list[list] | None":
    """Action name -> list of subprocess argv (each a separate step; stop on failure).

    `build` renders the DEPLOYED install in its detected theme + emit mode (so a
    rebuild from an imperial opencode-global install stays imperial and lands in
    the global config dir) — not a bare, neutral source render. `update` and
    `export` self-resolve the deployed theme downstream, so they take no args."""
    py = sys.executable
    h = str(ROOT / "rituals" / "harness.py")
    b = str(ROOT / "build.py")
    build_argv = harness._setup_build_args(theme, emit)
    return {
        "doctor": [[py, h, "doctor"]],
        "build": [[py, b, *build_argv]],
        "update": [[py, h, "sync-self"], [py, h, "upgrade"]],
        "export": [[py, h, "diff", "--out"]],
    }.get(action)


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
    as the `doctor` command (_doctor_collect fills `groups` as it runs)."""
    groups: list[dict] = []
    themes, problems = harness._doctor_collect(theme=state.theme, groups=groups)
    return {"themes": themes, "ok": not problems,
            "problems": problems, "groups": groups}


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
        with contextlib.redirect_stdout(io.StringIO()):   # swallow the emit's own log
            build.emit_opencode_global(state.theme, out=Path(tmp) / "bundle",
                                       cfg=expected)
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


OFFLINE_ZIP_SKIP = {".git", "node_modules", "__pycache__", ".superpowers"}


def offline_zip_bytes() -> "tuple[bytes, str]":
    """(zip bytes, download name) of the source tree — the sneakernet package a
    proxied/offline machine consumes with `geneseed upgrade --zip <file>`.
    `git archive` (tracked files only) when git is available; otherwise a
    zipfile walk skipping VCS/build litter. The geneseed-offline/ prefix matches
    what the consume side expects (a geneseed-* wrapper dir, like GitHub zips)."""
    name = f"geneseed-offline-{time.strftime('%Y%m%d')}.zip"
    try:
        p = subprocess.run(
            ["git", "archive", "--format=zip", "--prefix=geneseed-offline/", "HEAD"],
            cwd=str(ROOT), capture_output=True, timeout=60)
        if p.returncode == 0 and p.stdout:
            return p.stdout, name
    except (OSError, subprocess.TimeoutExpired):
        pass
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for f in sorted(ROOT.rglob("*")):
            rel = f.relative_to(ROOT)
            if f.is_file() and not (set(rel.parts) & OFFLINE_ZIP_SKIP):
                zf.write(f, f"geneseed-offline/{rel.as_posix()}")
    return buf.getvalue(), name


def api_overview(state: WebState) -> dict:
    inv = state.inventory
    themes, problems = harness._doctor_collect(theme=state.theme)
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
        "emit": state.emit,
        "target": str(state.target),
        "deployed": _deployed(state),
        "counts": {
            "agents": len(inv["agents"]),
            "skills": len(inv["skills"]),
            "laws": len(inv["laws"]),
            "memory": len(_memory_items(state)),
            "notebook": len(_notebook_items(state)),
        },
        "doctor": {"ok": not problems, "problems": problems},
        "diff": diff,
        "build_time": build_time,
    }


def make_handler(state: WebState, jm: JobManager, token: str, dist: Path):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *a):  # silence default stderr logging
            pass

        def _send_json(self, obj, code=200):
            body = json.dumps(obj).encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def _send_bytes(self, body: bytes, ctype: str, code=200, extra=None):
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            for k, v in (extra or {}).items():
                self.send_header(k, v)
            self.end_headers()
            self.wfile.write(body)

        # ---- GET ---------------------------------------------------------
        def do_GET(self):
            path = self.path.split("?", 1)[0]
            try:
                if path == "/api/overview":
                    return self._send_json(api_overview(state))
                if path.startswith("/api/catalog/"):
                    return self._send_json(api_catalog(state, path.rsplit("/", 1)[1]))
                if path.startswith("/api/item/"):
                    _, _, _, type_, name = path.split("/", 4)
                    return self._send_json(api_item(state, type_, name))
                if path == "/api/themes":
                    return self._send_json(api_themes(state))
                if path == "/api/setup":
                    return self._send_json(api_setup(state))
                if path == "/api/doctor":
                    return self._send_json(api_doctor(state))
                if path == "/api/offline-zip":
                    data, name = offline_zip_bytes()
                    return self._send_bytes(
                        data, "application/zip",
                        extra={"Content-Disposition": f'attachment; filename="{name}"'})
                if path == "/api/diff":
                    return self._send_json(api_diff(state))
                if path.startswith("/api/jobs/"):
                    j = jm.get(path.rsplit("/", 1)[1])
                    return self._send_json(j) if j \
                        else self._send_json({"error": "no such job"}, 404)
                return self._serve_static(path)
            except NotFound as e:
                return self._send_json({"error": f"not found: {e}"}, 404)
            except Exception as e:  # noqa: BLE001
                return self._send_json({"error": str(e)}, 500)

        def _read_json_body(self) -> dict:
            try:
                length = int(self.headers.get("Content-Length") or 0)
            except ValueError:
                length = 0
            if not length:
                return {}
            try:
                obj = json.loads(self.rfile.read(length) or b"{}")
                return obj if isinstance(obj, dict) else {}
            except Exception:  # noqa: BLE001
                return {}

        # ---- POST --------------------------------------------------------
        def do_POST(self):
            path = self.path.split("?", 1)[0]
            if self.headers.get("X-Geneseed-Token") != token:
                return self._send_json({"error": "forbidden"}, 403)
            if path.startswith("/api/actions/"):
                action = path.rsplit("/", 1)[1]
                body = self._read_json_body()
                # Restore is synchronous (one render, same cost as a diff GET)
                # and returns a structured result instead of a job id.
                if action == "restore":
                    return self._send_json(
                        api_restore(state, body.get("files") or []))
                # Build can be re-themed/re-targeted from the UI picker; the other
                # actions self-resolve the deployed theme downstream.
                if action == "build":
                    theme, emit = _build_override(state, body)
                else:
                    theme, emit = state.theme, state.emit
                cmds = action_commands(action, theme=theme, emit=emit)
                if not cmds:
                    return self._send_json({"error": f"unknown action {action}"}, 404)
                # Refresh when the job FINISHES — a Build may re-theme the
                # install, and the re-detect must read the new marker.
                jid = jm.start(action, *cmds, on_done=state.refresh)
                if jid is None:
                    return self._send_json({"error": "busy"}, 409)
                return self._send_json({"job_id": jid}, 202)
            return self._send_json({"error": "not found"}, 404)

        # ---- static (committed React build) ------------------------------
        def _serve_static(self, path):
            rel = "index.html" if path in ("/", "") else path.lstrip("/")
            fp = (dist / rel).resolve()
            if dist not in fp.parents and fp != (dist / "index.html").resolve():
                # SPA fallback: unknown / out-of-tree path -> index.html
                fp = dist / "index.html"
            if not fp.is_file():
                fp = dist / "index.html"
            if not fp.is_file():
                return self._send_json(
                    {"error": "web/dist missing — run the UI build"}, 500)
            data = fp.read_bytes()
            if fp.name == "index.html":
                inject = f'<script>window.__GENESEED_TOKEN__="{token}";</script>'
                data = data.replace(b"</head>", inject.encode() + b"</head>", 1)
            ctype = {
                ".html": "text/html", ".js": "text/javascript",
                ".css": "text/css", ".json": "application/json",
                ".svg": "image/svg+xml", ".ico": "image/x-icon",
                ".woff2": "font/woff2",
            }.get(fp.suffix, "application/octet-stream")
            return self._send_bytes(data, ctype)

    return Handler


def _build_plan(dist: Path, web_dir: Path, npm: str | None, interactive: bool) -> str:
    """Pure: what serve() should do about the UI bundle. 'serve' when dist is
    built; otherwise 'no-source' (web/ never arrived), 'no-npm', 'no-tty'
    (cannot prompt — scripts/CI), or 'ask' (buildable and interactive)."""
    if (dist / "index.html").is_file():
        return "serve"
    if not (web_dir / "package.json").is_file():
        return "no-source"
    if not npm:
        return "no-npm"
    if not interactive:
        return "no-tty"
    return "ask"


def _npm_build(npm: str, web_dir: Path) -> int:
    """Run npm install then npm run build in web/, output inherited so a slow
    or proxied install stays visible. Returns the first non-zero exit code."""
    for step in (("install",), ("run", "build")):
        print(f"[web] npm {' '.join(step)} ...")
        code = subprocess.run([npm, *step], cwd=web_dir).returncode
        if code:
            print(f"[web] npm {' '.join(step)} failed (exit {code}).")
            return code
    return 0


def serve(theme: str | None = None, port: int = 4747, open_browser: bool = True) -> int:
    dist = ROOT / "web" / "dist"
    web_dir = ROOT / "web"
    manual = "        cd web && npm install && npm run build"
    plan = _build_plan(dist, web_dir, shutil.which("npm"), sys.stdin.isatty())
    if plan == "no-source":
        print(f"[web] web/ sources are missing from {ROOT}.")
        print("      Run `geneseed upgrade` to fetch them (twice on installs whose")
        print("      updater predates web/ in the sync list).")
        return 1
    if plan == "no-npm":
        print("[web] web/dist is missing and npm was not found. Install Node.js,")
        print("      then build the UI:")
        print(manual)
        return 1
    if plan == "no-tty":
        print("[web] web/dist is missing. Build the UI first:")
        print(manual)
        return 1
    if plan == "ask":
        try:
            answer = input("[web] UI not built — run npm install && npm run build now? [Y/n] ")
        except (EOFError, KeyboardInterrupt):
            answer = "n"
        if answer.strip().lower() in ("", "y", "yes"):
            code = _npm_build(shutil.which("npm"), web_dir)
            if code:
                return code
        else:
            print("[web] skipped. Build the UI manually:")
            print(manual)
            return 0
    state = WebState(theme=theme)
    if not (state.target / build.GLOBAL_MANIFEST).exists():
        print(f"[web] no deployed harness at {state.target}.")
        print("      Run `geneseed setup` first — serving anyway (read-only UI).")
    jm = JobManager()
    token = secrets.token_urlsafe(24)
    Handler = make_handler(state, jm, token, dist)
    try:
        srv = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    except OSError:
        srv = ThreadingHTTPServer(("127.0.0.1", 0), Handler)  # fallback free port
    host_port = srv.server_address[1]
    url = f"http://127.0.0.1:{host_port}"
    print(f"[web] Geneseed UI on {url}  (theme: {state.theme})")
    print("[web] Ctrl-C to stop.")
    if open_browser:
        try:
            webbrowser.open(url)
        except Exception:  # noqa: BLE001
            pass
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\n[web] stopped.")
    return 0
