"""Geneseed web — the HTTP request handler, daemon lifecycle, and serve entry.

Part of the web API (see web.py). Imports the shared toolset from _web_core."""
from __future__ import annotations

from _web_core import *  # noqa: F401,F403  shared stdlib + primitives


def make_handler(state: WebState, jm: JobManager, token: str, dist: Path, holder: "dict | None" = None):
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

        # Read the `?harness=` query param (the Docs Claude/OpenCode selector);
        # None when absent, so the API resolves the installed default.
        def _harness(self):
            qs = urllib.parse.urlparse(self.path).query
            return urllib.parse.parse_qs(qs).get("harness", [None])[0]

        # ---- GET ---------------------------------------------------------
        def do_GET(self):
            path = self.path.split("?", 1)[0]
            try:
                if path == "/api/ping":
                    # Cheap liveness probe for `web status` / the daemon launcher.
                    return self._send_json({"ok": True, "theme": state.theme})
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
                if path == "/api/graph":
                    return self._send_json(api_graph(state))
                if path == "/api/mcp":
                    return self._send_json(api_mcp(state))
                if path == "/api/installs":
                    return self._send_json(api_installs(state))
                if path == "/api/offline-zip":
                    data, name = offline_zip_bytes()
                    return self._send_bytes(
                        data, "application/zip",
                        extra={"Content-Disposition": f'attachment; filename="{name}"'})
                if path == "/api/diff":
                    return self._send_json(api_diff(state))
                if path == "/api/docs":
                    return self._send_json(api_docs(state, self._harness()))
                if path.startswith("/api/docs/page/"):
                    pid = path[len("/api/docs/page/"):]
                    return self._send_json(
                        api_docs_page(state, urllib.parse.unquote(pid),
                                      self._harness()))
                if path == "/api/jobs":
                    return self._send_json({"jobs": jm.recent()})
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
            if path == "/api/shutdown":
                # Graceful self-stop, used by the in-page Stop control and
                # `geneseed web stop`. shutdown() must run off the request thread
                # or it deadlocks against serve_forever().
                srv = holder.get("srv") if holder else None
                if srv is not None:
                    threading.Thread(target=srv.shutdown, daemon=True).start()
                return self._send_json({"stopping": True})
            if path == "/api/restart":
                # Hand off to a detached `web restart` (it stops us, then starts a
                # fresh server on the same port) so the new daemon survives our exit.
                request_restart(state.theme)
                return self._send_json({"restarting": True})
            if path == "/api/mcp":
                try:
                    res = api_mcp_toggle(state, self._read_json_body())
                except NotFound as e:
                    return self._send_json({"error": f"not found: {e}"}, 404)
                return self._send_json(res, 200 if res.get("ok") else 409)
            if path == "/api/install":
                try:
                    res = api_install_toggle(state, self._read_json_body())
                except NotFound as e:
                    return self._send_json({"error": f"not found: {e}"}, 404)
                return self._send_json(res, 200 if res.get("ok") else 409)
            if path == "/api/memory/delete":
                try:
                    return self._send_json(
                        api_memory_delete(state, (self._read_json_body().get("name") or "")))
                except NotFound as e:
                    return self._send_json({"error": f"not found: {e}"}, 404)
            if path.startswith("/api/jobs/") and path.endswith("/cancel"):
                jid = path.split("/")[3]
                if jm.cancel(jid):
                    return self._send_json({"cancelled": jid})
                return self._send_json({"error": "no running job by that id"}, 404)
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
                ".webmanifest": "application/manifest+json",
                ".png": "image/png",
            }.get(fp.suffix, "application/octet-stream")
            return self._send_bytes(data, ctype)

    return Handler


# ---- daemon mode -----------------------------------------------------------
# `geneseed web start|stop|status` runs the server detached so it never blocks
# the terminal. State (pid/port/token/url) is written by the running server to a
# small JSON file beside the deployed host state; control is over HTTP — `stop`
# and the in-page Stop button both POST /api/shutdown — so we never need
# OS-specific process-kill semantics, only a localhost request with the token.

def _state_path(target: Path) -> Path:
    return target / ".geneseed-web.json"


def read_daemon(target: Path) -> "dict | None":
    try:
        return json.loads(_state_path(target).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def write_daemon(target: Path, data: dict) -> None:
    try:
        target.mkdir(parents=True, exist_ok=True)
        _state_path(target).write_text(json.dumps(data), encoding="utf-8")
    except OSError:
        pass


def clear_daemon(target: Path) -> None:
    try:
        _state_path(target).unlink()
    except OSError:
        pass


def _probe(url: str, timeout: float = 1.5) -> bool:
    """True if a Geneseed server is answering at url (GET /api/ping)."""
    try:
        with urllib.request.urlopen(f"{url}/api/ping", timeout=timeout) as r:
            return r.status == 200
    except (urllib.error.URLError, OSError, ValueError):
        return False


def _post_shutdown(url: str, token: str, timeout: float = 3.0) -> bool:
    req = urllib.request.Request(
        f"{url}/api/shutdown", data=b"{}", method="POST",
        headers={"X-Geneseed-Token": token, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status == 200
    except (urllib.error.URLError, OSError, ValueError):
        return False


def _live_daemon(target: Path) -> "dict | None":
    """Return the daemon state only if a server is actually answering; otherwise
    clear a stale state file and return None."""
    st = read_daemon(target)
    if st and st.get("url") and _probe(st["url"]):
        return st
    if st:
        clear_daemon(target)
    return None


def _spawn_detached(web_args: "list[str]", log: Path) -> None:
    """Popen `harness.py web <web_args>` fully detached, logging to `log`. Used to
    launch the daemon and (with a `restart` action) to re-launch it out-of-band so
    the spawner can exit/die without taking the new server down with it."""
    cmd = [sys.executable, str(Path(__file__).resolve().parent.parent / "rituals" / "harness.py"),
           "web", *web_args]
    kwargs: dict = {"stdin": subprocess.DEVNULL}
    try:
        logf = open(log, "ab")
        kwargs["stdout"] = logf
        kwargs["stderr"] = subprocess.STDOUT
    except OSError:
        kwargs["stdout"] = subprocess.DEVNULL
        kwargs["stderr"] = subprocess.DEVNULL
    if os.name == "nt":
        kwargs["creationflags"] = 0x00000008 | 0x00000200  # DETACHED_PROCESS | NEW_PROCESS_GROUP
    else:
        kwargs["start_new_session"] = True
    subprocess.Popen(cmd, **kwargs)


def request_restart(theme: "str | None") -> None:
    """Spawn a detached `web restart` that will stop this server and start a fresh
    one on the same port. Detached so it outlives the shutdown of the very process
    that called it — used by the in-page Restart button."""
    target = WebState(theme=theme).target
    log = target / ".geneseed-web.log"
    args = ["restart", "--no-browser"]
    if theme:
        args += ["--theme", theme]
    _spawn_detached(args, log)


def start_daemon(theme: "str | None", port: int, open_browser: bool = True) -> int:
    """Start the server detached (singleton). If one is already running, just
    reopen the browser. Returns 0 on success."""
    target = WebState(theme=theme).target
    st = _live_daemon(target)
    if st:
        print(f"[web] already running on {st['url']}  (pid {st.get('pid')})")
        if open_browser:
            with contextlib.suppress(Exception):
                webbrowser.open(st["url"])
        return 0
    clear_daemon(target)
    log = target / ".geneseed-web.log"
    cmd = ["--daemon-internal", "--port", str(port), "--no-browser"]
    if theme:
        cmd += ["--theme", theme]
    _spawn_detached(cmd, log)
    # Wait for the child to bind and write its state (pid/port/url).
    for _ in range(60):
        st = read_daemon(target)
        if st and st.get("url") and _probe(st["url"], timeout=0.5):
            print(f"[web] Geneseed UI on {st['url']}  (theme: {st.get('theme')}, pid {st.get('pid')})")
            print("[web] running in the background — `geneseed web stop` to stop it.")
            if open_browser:
                with contextlib.suppress(Exception):
                    webbrowser.open(st["url"])
            return 0
        time.sleep(0.2)
    print("[web] daemon did not come up in time — check the log:")
    print(f"      {log}")
    return 1


def stop_daemon(theme: "str | None" = None) -> int:
    target = WebState(theme=theme).target
    st = read_daemon(target)
    if not st or not st.get("url"):
        print("[web] no running server recorded.")
        return 0
    if _post_shutdown(st["url"], st.get("token", "")):
        clear_daemon(target)
        print(f"[web] stopped (pid {st.get('pid')}).")
        return 0
    # Server unreachable — the state was stale.
    clear_daemon(target)
    print("[web] no live server (cleared a stale record).")
    return 0


def status_daemon(theme: "str | None" = None) -> int:
    target = WebState(theme=theme).target
    st = _live_daemon(target)
    if st:
        print(f"[web] running on {st['url']}  (theme: {st.get('theme')}, pid {st.get('pid')})")
        return 0
    print("[web] not running.")
    return 1


def restart_daemon(theme: "str | None" = None, port: int = 4747,
                   open_browser: bool = True, only_if_running: bool = False) -> int:
    """Stop and start the daemon so it picks up new source / static bundle.
    Preserves the port the running daemon was bound to; with no daemon running,
    falls back to `port`. With `only_if_running=True` returns 0 silently when
    nothing was running — used by `geneseed upgrade` to refresh a live daemon
    without spawning one the user didn't ask for."""
    target = WebState(theme=theme).target
    st = read_daemon(target)
    live = _live_daemon(target) is not None
    if only_if_running and not live:
        return 0
    use_port = (st.get("port") if st and st.get("port") else None) or port
    if live:
        # ponytail: no portable way to query open browser tabs. A live daemon
        # means a tab was already opened on this (preserved) port and will
        # reconnect on its own — so don't pop a duplicate window.
        open_browser = False
        stop_daemon(theme)
        # Wait briefly for the OS to release the port before re-binding;
        # otherwise start_daemon falls back to a random free port and any
        # client (the PWA) cached on the old URL would miss the new server.
        for _ in range(50):
            if not _probe(f"http://127.0.0.1:{use_port}", timeout=0.2):
                break
            time.sleep(0.1)
    return start_daemon(theme, use_port, open_browser=open_browser)


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


def serve(theme: str | None = None, port: int = 4747, open_browser: bool = True,
          daemon: bool = False) -> int:
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
    # Console history lives beside the deployed host state (context.json & co);
    # writes fail silently when nothing is deployed there yet.
    jm = JobManager(history_path=state.target / ".geneseed-web-runs.json")
    token = secrets.token_urlsafe(24)
    holder: dict = {}
    Handler = make_handler(state, jm, token, dist, holder)
    try:
        srv = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    except OSError:
        srv = ThreadingHTTPServer(("127.0.0.1", 0), Handler)  # fallback free port
    holder["srv"] = srv
    host_port = srv.server_address[1]
    url = f"http://127.0.0.1:{host_port}"
    # In daemon mode the running server records its own pid/port/token/url so the
    # launcher can reopen the browser and `web stop` can reach /api/shutdown.
    if daemon:
        write_daemon(state.target, {
            "pid": os.getpid(), "port": host_port, "url": url,
            "token": token, "theme": state.theme, "started": int(time.time()),
        })
    print(f"[web] Geneseed UI on {url}  (theme: {state.theme})")
    print("[web] Ctrl-C to stop." if not daemon else "[web] daemon ready.")
    if open_browser:
        try:
            webbrowser.open(url)
        except Exception:  # noqa: BLE001
            pass
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\n[web] stopped.")
    finally:
        if daemon:
            clear_daemon(state.target)
    return 0
