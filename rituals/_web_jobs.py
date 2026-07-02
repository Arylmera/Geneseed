"""Geneseed web — background job runner and the action command table.

Part of the web API (see web.py). Imports the shared toolset from _web_core."""
from __future__ import annotations

from _web_core import *  # noqa: F401,F403  shared stdlib + primitives

import signal  # noqa: E402


def _kill_job_tree(p: "subprocess.Popen") -> None:
    """Terminate a job's WHOLE process tree. Killing only the direct child
    (harness.py) leaves its own children (build.py, git) holding the stdout
    pipe — the run thread stays blocked on it and the job wedges 'running'."""
    try:
        if sys.platform == "win32":
            subprocess.run(["taskkill", "/T", "/F", "/PID", str(p.pid)],
                           capture_output=True, timeout=15, **harness.NO_WINDOW)
        else:
            os.killpg(p.pid, signal.SIGTERM)
    except (OSError, subprocess.SubprocessError):
        try:
            p.terminate()
        except OSError:
            pass


class JobManager:
    """Runs one mutating action at a time in a background thread, capturing
    combined stdout/stderr. A second start() while busy returns None (the HTTP
    layer maps that to 409). Finished jobs persist to `history_path` (last
    HISTORY_MAX, output capped) so the console survives reload and restart."""

    HISTORY_MAX = 20
    OUTPUT_CAP = 20000     # chars of output kept per job in the history file
    MEM_CAP = 2_000_000    # chars kept in memory per job while it runs

    def __init__(self, history_path: "Path | None" = None):
        self._lock = threading.Lock()
        self._jobs: dict[str, dict] = {}
        self._busy = False
        self._procs: dict[str, subprocess.Popen] = {}
        self._history_path = history_path
        self._load_history()

    def _load_history(self):
        if not self._history_path or not self._history_path.is_file():
            return
        try:
            jobs = json.loads(self._history_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return
        for j in jobs if isinstance(jobs, list) else []:
            # A 'running' job in the file means the server died mid-run.
            if isinstance(j, dict) and j.get("id") and j.get("status") != "running":
                self._jobs[j["id"]] = j

    def _save_history(self):
        if not self._history_path:
            return
        with self._lock:
            jobs = [dict(j) for j in self._jobs.values() if j["status"] != "running"]
        jobs.sort(key=lambda j: j.get("started") or 0)
        jobs = [{**j, "output": j["output"][-self.OUTPUT_CAP:]}
                for j in jobs[-self.HISTORY_MAX:]]
        try:
            self._history_path.write_text(json.dumps(jobs), encoding="utf-8")
        except OSError:
            pass

    def recent(self, n: int = HISTORY_MAX) -> list:
        """Last `n` jobs, oldest first — the order the console appends in."""
        with self._lock:
            jobs = sorted(self._jobs.values(), key=lambda j: j.get("started") or 0)
            return [dict(j) for j in jobs[-n:]]

    def start(self, action: str, *cmds: list, on_done=None) -> "str | None":
        with self._lock:
            if self._busy:
                return None
            self._busy = True
            jid = secrets.token_hex(8)
            self._jobs[jid] = {"id": jid, "action": action, "status": "running",
                               "output": "", "returncode": None,
                               "started": time.time(), "duration": None}
        t = threading.Thread(target=self._run, args=(jid, cmds, on_done), daemon=True)
        t.start()
        return jid

    def _append(self, jid: str, text: str):
        with self._lock:
            j = self._jobs[jid]
            j["output"] += text
            if len(j["output"]) > self.MEM_CAP:   # a runaway job can't eat the daemon
                j["output"] = j["output"][-self.MEM_CAP:]

    def _run(self, jid: str, cmds, on_done=None):
        rc = 0
        p = None
        try:
            for i, cmd in enumerate(cmds):
                self._append(jid, f"$ {' '.join(str(c) for c in cmd)}\n")
                # Stream combined stdout/stderr line-by-line so the web console
                # fills live (terminal-style) instead of dumping at the end.
                # PYTHONUNBUFFERED reaches the child AND its own python children
                # (harness.py -> build.py / doctor), otherwise their stdout is
                # block-buffered into the pipe and the console looks stuck.
                # GENESEED_WEB_JOB tells `upgrade` it runs INSIDE this daemon, so
                # it must not bounce the daemon mid-job (that killed the job's
                # tracking and left the console on 'running' forever) — the
                # server restarts itself after the job is saved as finished.
                # start_new_session gives the job its own process GROUP, so
                # cancel() can kill the whole tree, not just harness.py.
                kw: dict = dict(harness.NO_WINDOW)
                if sys.platform != "win32":
                    kw["start_new_session"] = True
                p = subprocess.Popen(
                    cmd, cwd=str(ROOT), stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT, text=True,
                    encoding="utf-8", errors="replace", bufsize=1,
                    env={**os.environ, "PYTHONUNBUFFERED": "1",
                         "GENESEED_WEB_JOB": "1"},
                    **kw)
                with self._lock:
                    self._procs[jid] = p   # reachable for cancel()
                for line in p.stdout:
                    self._append(jid, line)
                p.wait()
                with self._lock:
                    self._procs.pop(jid, None)
                rc = p.returncode
                if rc != 0:
                    left = len(cmds) - i - 1
                    self._append(
                        jid,
                        f"\n[web] ✗ command exited with code {rc}"
                        + (f" — skipping the {left} remaining step(s).\n" if left
                           else ".\n"))
                    break
        except Exception as e:  # noqa: BLE001
            self._append(jid, f"\n[web] job crashed: {e}")
            rc = 1
            # Don't orphan the child on a crash of OUR side (pipe error etc.):
            # kill its tree and reap it, or it lingers as a zombie in the daemon.
            if p is not None and p.poll() is None:
                _kill_job_tree(p)
                try:
                    p.wait(timeout=10)
                except (OSError, subprocess.TimeoutExpired):
                    pass
        finally:
            with self._lock:
                self._procs.pop(jid, None)
                j = self._jobs[jid]
                j.update(status="done" if rc == 0 else "failed", returncode=rc,
                         duration=round(time.time() - j["started"], 1))
                self._busy = False
            self._save_history()
            if on_done:
                try:
                    on_done()
                except Exception:  # noqa: BLE001 — refresh must never kill the job thread
                    pass

    def cancel(self, jid: str) -> bool:
        """Terminate the running job's subprocess; the run thread then winds down
        normally (stdout closes, wait() returns non-zero -> status 'failed')."""
        with self._lock:
            p = self._procs.get(jid)
            j = self._jobs.get(jid)
            if p is None or not j or j["status"] != "running":
                return False
        self._append(jid, "\n[web] cancelled by user.\n")
        _kill_job_tree(p)
        return True

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
                    emit: str = "opencode-global",
                    footprint: str = "full") -> "list[list] | None":
    """Action name -> list of subprocess argv (each a separate step; stop on failure).

    `build` renders the DEPLOYED install in its detected theme + emit mode + footprint
    (so a rebuild from an imperial, lean opencode-global install stays imperial and lean
    in the global config dir) — not a bare, neutral source render. `update` and
    `export` self-resolve the deployed theme downstream, so they take no args."""
    py = sys.executable
    h = str(ROOT / "rituals" / "harness.py")
    b = str(ROOT / "build.py")
    build_argv = harness._setup_build_args(theme, emit, footprint=footprint)
    return {
        "doctor": [[py, h, "doctor"]],
        "build": [[py, b, *build_argv]],
        # Rebuild EVERY active install in place (each in its own theme+emit). The
        # per-install resolution lives in the rebuild-all subcommand, so the web layer
        # threads no theme/emit — one job, best-effort across all installs.
        "build-all": [[py, h, "rebuild-all"]],
        "update": [[py, h, "upgrade"]],
        "export": [[py, h, "diff", "--out"]],
        # Local-machine maintenance, surfaced in the web Settings. uninstall keeps
        # memory (never deleted) and runs non-interactively with --yes.
        "link": [[py, h, "link"]],
        "unlink": [[py, h, "unlink"]],
        "uninstall": [[py, h, "uninstall", "--yes"]],
    }.get(action)
