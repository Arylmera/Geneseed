#!/usr/bin/env python3
"""Geneseed web UI — local, dependency-free HTTP server over the deployed Harness.

Pure API functions (api_overview/api_catalog/api_item/api_diff) are unit-tested
without sockets; the HTTP handler is a thin JSON shell around them. Mutating
actions run as background subprocess jobs (fire-and-notify). Reuses harness.py
and build.py for every read so the web and TUI never disagree.
"""
from __future__ import annotations

import json
import re
import secrets
import subprocess
import sys
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
        self._inv = None


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

    def start(self, action: str, *cmds: list) -> "str | None":
        with self._lock:
            if self._busy:
                return None
            self._busy = True
            jid = secrets.token_hex(8)
            self._jobs[jid] = {"id": jid, "action": action, "status": "running",
                               "output": "", "returncode": None}
        t = threading.Thread(target=self._run, args=(jid, cmds), daemon=True)
        t.start()
        return jid

    def _append(self, jid: str, text: str):
        with self._lock:
            self._jobs[jid]["output"] += text

    def _run(self, jid: str, cmds):
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


def api_diff(state: WebState) -> dict:
    target, theme, files = harness._diff_collect(target=state.target, theme=state.theme)
    return {
        "deployed": files is not None,
        "target": str(target),
        "theme": theme,
        "files": files or [],
    }


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

        def _send_bytes(self, body: bytes, ctype: str, code=200):
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
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

        # ---- POST --------------------------------------------------------
        def do_POST(self):
            path = self.path.split("?", 1)[0]
            if self.headers.get("X-Geneseed-Token") != token:
                return self._send_json({"error": "forbidden"}, 403)
            if path.startswith("/api/actions/"):
                action = path.rsplit("/", 1)[1]
                cmds = action_commands(action, theme=state.theme, emit=state.emit)
                if not cmds:
                    return self._send_json({"error": f"unknown action {action}"}, 404)
                jid = jm.start(action, *cmds)
                if jid is None:
                    return self._send_json({"error": "busy"}, 409)
                state.refresh()
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


def serve(theme: str | None = None, port: int = 4747, open_browser: bool = True) -> int:
    dist = ROOT / "web" / "dist"
    if not (dist / "index.html").is_file():
        print("[web] web/dist is missing. Build the UI first:")
        print("        cd web && npm install && npm run build")
        return 1
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
