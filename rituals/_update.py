#!/usr/bin/env python3
"""Cross-platform self-update for Geneseed — `git pull` the install's own origin,
validate, then rebuild.

`upgrade()` runs a two-phase preflight (Phase A, local: is this a git checkout, detached
HEAD, dirty tree, missing upstream; Phase B, network: `git fetch` + ahead/behind), then
fast-forwards the working tree to its upstream (`git merge --ff-only`), doctor-gates the
result (`doctor --all --no-bundle`, rolling back with `git reset --hard` on failure), and
re-renders the bundle. The update source is whatever the install was cloned from (its
`.git` origin) — no hardcoded repo, host-agnostic. `sync_self()` and the `update`
subcommand are aliases of `upgrade()`; theme + emit-mode precedence is preserved
(explicit arg > markers > config > default).

`harness.py` calls `upgrade()` / `sync_self()` here directly. This module NEVER pushes — it
only reads from the remote (fetch + merge --ff-only). Every git call goes through the `_git`
seam, which is which-guarded, credential-scrubbed, and never raises.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time
from collections import namedtuple
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import build  # noqa: E402  (path adjusted above)

_CREDS_RE = re.compile(r"(://)[^/@\s]+@")


def _redact_url_creds(text: str) -> str:
    """Strip a `user[:token]@` userinfo from any URL in `text` so a tokened
    remote never reaches a log line or an HTTP response."""
    return _CREDS_RE.sub(r"\1", text or "")


# Windows spawns a visible console for every child console process started from a
# console-less parent (the web daemon runs `upgrade` in a subprocess). CREATE_NO_WINDOW
# suppresses it while still allowing piped output; on POSIX it is an empty dict. Mirrors
# harness.NO_WINDOW, redefined here so this module stays importable standalone (self-heal).
_NO_WINDOW: dict = (
    {"creationflags": subprocess.CREATE_NO_WINDOW}
    if sys.platform == "win32" else {}
)

OriginDisplay = namedtuple("OriginDisplay", ["url", "github_slug"])
DEFAULT_ORIGIN = OriginDisplay("https://github.com/Arylmera/Geneseed", "Arylmera/Geneseed")


def _git(*args, timeout: int = 10, network: bool = False):
    """Run `git -C ROOT <args>` per the shared contract: which-guarded, no-window,
    stripped + credential-redacted output, never raises. Returns (rc, out, err);
    rc is None when git is absent or the spawn failed. THE monkeypatch seam for tests."""
    exe = shutil.which("git")
    if not exe:
        return (None, "", "")
    cmd = [exe, "-C", str(ROOT)]
    env = None
    if network:
        env = {**os.environ, "GIT_TERMINAL_PROMPT": "0"}
        cmd += ["-c", "http.lowSpeedLimit=1000", "-c", "http.lowSpeedTime=15"]
    cmd += [str(a) for a in args]
    try:
        # encoding pinned: git talks UTF-8; text=True would decode with the console
        # code page (cp1252 on corporate Windows) and a stray byte would turn a
        # perfectly good git call into rc=None ("git is not installed").
        p = subprocess.run(cmd, capture_output=True, encoding="utf-8",
                           errors="replace", timeout=timeout, env=env, **_NO_WINDOW)
    except Exception:                       # spawn/timeout/OS error -> treated as failure
        return (None, "", "")
    return (p.returncode,
            _redact_url_creds((p.stdout or "").strip()),
            _redact_url_creds((p.stderr or "").strip()))


def _parse_origin(origin: str) -> OriginDisplay:
    """(browser url, github_slug) from a git remote URL of any scheme. Userinfo and
    port dropped from the url; slug set only for a two-segment github.com path."""
    o = (origin or "").strip()
    host = path = ""
    if "://" not in o and "@" in o and ":" in o.split("@", 1)[1]:
        hostpart, path = o.split("@", 1)[1].split(":", 1)      # scp-form git@host:owner/repo
        host = hostpart
    else:
        u = urlsplit(o)
        host, path = (u.hostname or ""), u.path
    host = host.lower()
    path = path.strip("/")
    if path.lower().endswith(".git"):
        path = path[:-4]
    if not (host and path):
        return DEFAULT_ORIGIN
    url = f"https://{host}/{path}"
    slug = None
    if host == "github.com":
        segs = [s for s in path.split("/") if s]
        if len(segs) == 2:
            slug = "/".join(segs)
    return OriginDisplay(url, slug)


def _origin_display() -> OriginDisplay:
    """The install's origin as a display record, or DEFAULT_ORIGIN when absent."""
    rc, out, _ = _git("remote", "get-url", "origin")
    if rc != 0 or not out:
        return DEFAULT_ORIGIN
    return _parse_origin(out)


Preflight = namedtuple("Preflight", ["ok", "code", "kind", "message"])

_PRE_MSG = {
    "no_git_exe": ("info", "git is not installed or not on PATH — install git to enable updates."),
    "not_git":    ("info", "This Geneseed install isn't a git checkout — re-clone it with git to enable updates."),
    "detached":   ("info", "HEAD is detached (a tag/commit is checked out). Run `git checkout <branch>` to re-enable updates."),
    "no_upstream": ("info", "Your branch has no upstream — set one with `git branch --set-upstream-to`."),
    "dirty":      ("info", "You have local changes in the Geneseed folder. Commit or stash them, then update."),
    "ready":      ("info", ""),
}


def _pre(code: str) -> "Preflight":
    kind, msg = _PRE_MSG[code]
    return Preflight(code == "ready", code, kind, msg)


def _preflight() -> "Preflight":
    """Phase A — local only, no network. Never raises."""
    rc, out, _ = _git("rev-parse", "--is-inside-work-tree")
    if rc is None:
        return _pre("no_git_exe")
    if rc != 0 or out != "true":
        return _pre("not_git")
    rc, out, _ = _git("symbolic-ref", "-q", "HEAD")
    if rc != 0 or not out:
        return _pre("detached")
    rc, _, _ = _git("rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}")
    if rc != 0:
        return _pre("no_upstream")
    rc, out, _ = _git("-c", "core.fileMode=false", "-c", "core.autocrlf=false",
                      "status", "--porcelain", "--untracked-files=no")
    if rc != 0:
        return _pre("not_git")
    if out:
        return _pre("dirty")
    return _pre("ready")


def _fetch_timeout() -> int:
    try:
        return max(30, int(os.environ.get("GENESEED_NET_TIMEOUT", "120")))
    except ValueError:
        return 120


def _count(s: str) -> int:
    s = (s or "").strip()
    return int(s) if s.isdigit() else 0


def _kill_tree(p: subprocess.Popen) -> None:
    """Kill a fetch AND its helpers (git-remote-https). Killing only `git` leaves
    the helper holding the output pipe (and .git lock files on Windows), which is
    how a timed-out fetch used to hang the updater forever."""
    try:
        if sys.platform != "win32":
            os.killpg(p.pid, signal.SIGKILL)
        else:
            subprocess.run(["taskkill", "/F", "/T", "/PID", str(p.pid)],
                           capture_output=True, timeout=15, **_NO_WINDOW)
    except (OSError, subprocess.SubprocessError):
        try:
            p.kill()
        except OSError:
            pass


def _fetch_streaming(log=None):
    """`git fetch --progress` with live output, a heartbeat, and a HARD deadline.

    Streams git's own progress lines (Counting/Compressing/Receiving objects) to
    `log` as they arrive, logs a "still fetching" heartbeat every 15s when git is
    silent, and kills the whole process group at _fetch_timeout(). Returns
    (rc, tail) — rc None on spawn failure or timeout, tail = last output lines
    for the error message. THE monkeypatch seam for tests (network only here)."""
    exe = shutil.which("git")
    if not exe:
        return (None, "git is not installed or not on PATH")
    timeout = _fetch_timeout()
    cmd = [exe, "-C", str(ROOT),
           "-c", "http.lowSpeedLimit=1000", "-c", "http.lowSpeedTime=15",
           "fetch", "--progress"]
    kw: dict = dict(_NO_WINDOW)
    if sys.platform != "win32":
        kw["start_new_session"] = True          # own process group => killable tree
    try:
        p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                             text=True, encoding="utf-8", errors="replace", bufsize=1,
                             env={**os.environ, "GIT_TERMINAL_PROMPT": "0"}, **kw)
    except Exception as e:                      # noqa: BLE001 — same contract as _git
        return (None, str(e))
    lines: list[str] = []

    def _reader():
        # Text mode treats git's \r progress repaints as line breaks; the same
        # counter arrives hundreds of times, so only log when the phase changes.
        last = ""
        for raw in p.stdout:
            line = _redact_url_creds(raw.strip())
            if not line:
                continue
            lines.append(line)
            phase = line.split(":", 1)[0]
            if log and phase != last:
                log(f"[geneseed]   {line}")
                last = phase

    t = threading.Thread(target=_reader, daemon=True)
    t.start()
    start = time.monotonic()
    next_beat = 15.0
    while p.poll() is None:
        elapsed = time.monotonic() - start
        if elapsed >= timeout:
            _kill_tree(p)
            try:
                p.wait(timeout=5)     # reap — the daemon is long-lived
            except (OSError, subprocess.TimeoutExpired):
                pass
            if log:
                log(f"[geneseed] ✗ fetch produced nothing for {timeout}s — killed it.")
            return (None, "\n".join(lines[-5:]))
        if log and elapsed >= next_beat:
            log(f"[geneseed]   ... still fetching ({int(elapsed)}s elapsed)")
            next_beat += 15.0
        time.sleep(0.25)
    t.join(timeout=5)
    return (p.returncode, "\n".join(lines[-5:]))


def _measure_upstream(log=None):
    """Phase B — fetch (streamed), then classify. Returns (code, behind, err)
    where code ∈ {ready, fetch_failed, unrelated, diverged, uptodate}."""
    rc, err = _fetch_streaming(log)
    if rc != 0:
        return ("fetch_failed", 0, err)
    _, ahead, _ = _git("rev-list", "--count", "@{u}..HEAD")
    _, behind, _ = _git("rev-list", "--count", "HEAD..@{u}")
    ahead, behind = _count(ahead), _count(behind)
    if ahead > 0:
        mrc, _, _ = _git("merge-base", "HEAD", "@{u}")
        return (("diverged" if mrc == 0 else "unrelated"), 0, "")
    if behind == 0:
        return ("uptodate", 0, "")
    return ("ready", behind, "")


def _pull_and_validate(log) -> tuple[bool, str, str]:
    """Fast-forward to @{u}, then doctor-gate with exact rollback. Assumes preflight
    ok and _measure_upstream == ('ready', behind>0). Returns (ok, code, message)."""
    rc, old, _ = _git("rev-parse", "HEAD")
    if rc != 0 or not old:
        return (False, "not_git", "could not read HEAD")
    log("[geneseed] fast-forwarding to upstream ...")
    rc, _, err = _git("merge", "--ff-only", "@{u}", timeout=60)
    if rc != 0:
        return (False, "collision",
                "Update blocked — a new upstream file collides with a local untracked "
                "file. Move or remove it, then update.\n" + err)
    rc, pulled, _ = _git("log", "--oneline", "--no-decorate", "-20", f"{old}..HEAD")
    if rc == 0 and pulled:
        log("[geneseed] pulled:")
        for line in pulled.splitlines():
            log(f"  {line}")
    log("[geneseed] validating the pulled source (doctor — can take a minute) ...")
    passed, output = _run_doctor(ROOT)
    log(output.rstrip("\n"))
    if not passed:
        _git("reset", "--hard", old, timeout=60)
        for line in DOCTOR_LEGEND:
            log(line)
        return (False, "doctor_fail",
                "the pulled source FAILS validation — rolled back to the previous commit. "
                "Fix the problems listed above.")
    return (True, "ready", "")


def _logfile() -> Path:
    """Persistent install log, overridable with $GENESEED_LOG. Falls back to the temp
    dir if the home location is not writable (parity with upgrade.sh)."""
    env = os.environ.get("GENESEED_LOG")
    if env:
        return Path(env)
    return Path.home() / ".geneseed-install.log"


class _Log:
    def __init__(self) -> None:
        self.path = _logfile()
        try:
            self.path.write_text("", encoding="utf-8")          # truncate
        except OSError:
            self.path = Path(tempfile.gettempdir()) / "geneseed-install.log"
            try:
                self.path.write_text("", encoding="utf-8")
            except OSError:
                self.path = None  # type: ignore[assignment]

    def __call__(self, msg: str) -> None:
        # flush=True so progress lines reach a piped consumer (the web console
        # streams this process's stdout) immediately, not on buffer boundaries.
        print(msg, flush=True)
        if self.path is not None:
            try:
                with self.path.open("a", encoding="utf-8") as fh:
                    fh.write(msg + "\n")
            except OSError:
                pass


DOCTOR_LEGEND = [
    "[geneseed] doctor problem legend — what the lines above mean / how to fix:",
    "  • 'dead link'          → a skill/agent body links a sibling as <dir>/<name>.md; use the BARE <name>.md (source bug)",
    "  • 'unresolved token'   → a {{TOKEN}} is missing from a theme; add it to ALL theme JSONs",
    "  • 'incomplete source'  → AGENT.md lists a skill whose file isn't in this snapshot (usually a mid-publish cache — retry)",
    "  • 'stale' / 'missing'  → the rendered Harness/ is out of sync (rebuild locally; harmless on a fresh clone)",
    "  • 'parity'             → the themes disagree on which tokens exist",
    "  • 'escapes the bundle' → an absolute or ../ path leaked into a rendered file",
]


def _run_doctor(cand: Path) -> tuple[bool, str]:
    """Validate a source tree with its OWN `doctor --all --no-bundle` (the bundle is
    rebuilt right after, so its drift is expected). Fail-closed: any nonzero exit,
    timeout, or spawn error is a failure."""
    try:
        # encoding pinned: the doctor child reconfigures ITS stdout to UTF-8, so
        # text=True (console code page, cp1252 on corporate Windows) can raise
        # UnicodeDecodeError on a ✓/⚠️ glyph — which lands in the except below and
        # rolls back a perfectly good update as "doctor gate could not run".
        proc = subprocess.run(
            [sys.executable, str(cand / "rituals" / "harness.py"),
             "doctor", "--all", "--no-bundle"],
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            encoding="utf-8", errors="replace", timeout=300, **_NO_WINDOW)
    except Exception as e:                          # noqa: BLE001 — crash/timeout => fail
        return (False, f"[geneseed] doctor gate could not run: {e}")
    return (proc.returncode == 0, proc.stdout or "")


def _opencode_config_dir() -> Path:
    return build._opencode_config_dir()


def _resolve_emit(cfg: Path, out: Path) -> str:
    """Emit precedence: $GENESEED_EMIT > global-config marker > bundle marker > files."""
    env = os.environ.get("GENESEED_EMIT")
    if env:
        return env
    for marker in (cfg / ".geneseed-emit", out / ".geneseed-emit"):
        try:
            val = marker.read_text(encoding="utf-8").strip()
            if val:
                return val
        except OSError:
            pass
    return "files"


def _marker_theme(cfg: Path, out: Path) -> str:
    """Theme marker precedence: global-config marker > bundle marker > "" (none).
    Global installs write .geneseed-theme into the config dir; plain bundles into out."""
    for marker in (cfg / ".geneseed-theme", out / ".geneseed-theme"):
        try:
            val = marker.read_text(encoding="utf-8").strip()
            if val:
                return val
        except OSError:
            pass
    return ""


def _migrate_stray_bundle(here: Path, out: Path, log: _Log) -> None:
    """Move host state (context.json, memory/) from an OLD in-folder bundle (here/Harness)
    to the canonical sibling `out` BEFORE rebuilding, then drop the stray."""
    stray = here / "Harness"
    if out == stray or not stray.is_dir():
        return
    out.mkdir(parents=True, exist_ok=True)
    ctx = stray / "context.json"
    if ctx.is_file() and not (out / "context.json").is_file():
        shutil.copy2(ctx, out / "context.json")
        log(f"[geneseed] rescued context.json from {stray} -> {out}")
    for mem in ("memory", "anamnesis"):
        if (stray / mem).is_dir() and not (out / mem).is_dir():
            shutil.copytree(stray / mem, out / mem)
            log(f"[geneseed] rescued {mem}/ from {stray} -> {out}")
    log(f"[geneseed] removing stray in-folder bundle {stray} (canonical: {out})")
    shutil.rmtree(stray)


def _config_theme(here: Path) -> str:
    """The theme the LOCAL harness.config.json asks for, captured before SYNC overwrites
    it with upstream's (which ships neutral). Fallback only — a bundle marker still wins."""
    try:
        data = json.loads((here / "harness.config.json").read_text(encoding="utf-8"))
        return str(data.get("theme", "") or "")
    except (OSError, json.JSONDecodeError):
        return ""


def _rebuild_bundle(here, out, theme, emit, root_dir, log) -> int:
    """Render the bundle from the (already-updated) source and bounce a running web
    daemon. Returns the build subprocess returncode (0 = ok)."""
    build_args = ["--out", str(out)]
    if theme:
        build_args += ["--theme", theme]
    if emit == "opencode":
        build_args += ["--emit", "opencode", "--root", str(root_dir)]
    elif emit == "opencode-global":
        build_args += ["--emit", "opencode-global"]
    log(f"[geneseed] rebuilding bundle -> {out} (theme: {theme or 'config default'}, emit: {emit}) ...")
    import subprocess
    proc = subprocess.run([sys.executable, str(here / "build.py"), *build_args], cwd=str(here))
    if proc.returncode != 0:
        return proc.returncode
    # If a web daemon is running, bounce it so the new rituals/* source and the freshly
    # rebuilt web/dist take effect — otherwise the open PWA keeps hitting the old code.
    # EXCEPT when this upgrade IS a web-daemon job: restarting the daemon here kills
    # the process tracking this very job (console stuck on 'running' forever); in that
    # case the server restarts itself once the job is recorded as finished.
    if os.environ.get("GENESEED_WEB_JOB"):
        log("[geneseed] web daemon will restart itself after this job to load the new code.")
        return 0
    try:
        sys.path.insert(0, str(here / "rituals"))
        import web as _web  # noqa: E402
        _web.restart_daemon(theme=theme, open_browser=False, only_if_running=True)
    except Exception as e:  # noqa: BLE001  — never fail an upgrade on this
        log(f"[geneseed] ⚠️  could not refresh the web daemon ({e}) — `geneseed web restart` manually if it was running.")
    return 0


def _rebuild_installs(here: Path, log: _Log) -> int:
    """Refresh every registered ACTIVE install (opencode/claude/bob/copilot, global and
    project scope) via `harness.py rebuild-all`. The emit-marker rebuild only covers
    THIS checkout's own bundle — without this pass a claude-global or bob install
    keeps serving the OLD render after every upgrade, silently."""
    log("[geneseed] refreshing every active install (rebuild-all) ...")
    proc = subprocess.run(
        [sys.executable, str(here / "rituals" / "harness.py"), "rebuild-all"],
        cwd=str(here), **_NO_WINDOW)
    return proc.returncode


def upgrade(ref: str | None = None, theme_arg: str | None = None,
            zip_arg: str | None = None) -> int:
    """Update from the install's own git origin (fast-forward only), doctor-gate, and
    rebuild the bundle plus every registered install. `ref`/`zip_arg` are accepted for
    back-compat but IGNORED (git follows the current branch; the offline path was
    removed). Returns a process exit code: 0 ok/up-to-date, 3 info precondition,
    1 error."""
    log = _Log()
    if ref:
        log(f"[geneseed] ⚠️  ref '{ref}' is IGNORED — updates follow the checkout's "
            "current branch (tag/branch pinning was removed with the zip path).")
    here = ROOT
    out = Path(os.environ.get("GENESEED_OUT") or (here.parent / "Harness"))
    root_dir = Path(os.environ.get("GENESEED_ROOT") or out.parent)
    cfg = _opencode_config_dir()
    emit = _resolve_emit(cfg, out)

    # Capture the LOCAL theme before the pull overwrites harness.config.json.
    config_theme = _config_theme(here)

    origin = _origin_display()
    _, branch, _ = _git("rev-parse", "--abbrev-ref", "HEAD")
    log(f"[geneseed] update source: {origin.url}"
        + (f" (branch: {branch})" if branch else ""))

    log("[geneseed] preflight: checking the local checkout ...")
    pre = _preflight()
    if not pre.ok:
        log(f"[geneseed] {pre.message}")
        return 3 if pre.kind == "info" else 1

    log(f"[geneseed] fetching from origin (git: {shutil.which('git') or 'git'}, "
        f"timeout: {_fetch_timeout()}s) ...")
    code, behind, err = _measure_upstream(log)
    if code == "fetch_failed":
        log(f"[geneseed] ✗ could not reach the remote: "
            f"{err or 'git fetch hung without any output.'}")
        log("[geneseed]   If `git pull` works in your terminal but not here, this "
            "daemon likely lacks your shell's environment (VPN/proxy vars, SSO or "
            "Kerberos credentials). Restart it from that terminal: `geneseed web restart`.")
        return 1
    if code == "unrelated":
        log("[geneseed] Upstream history was rewritten; back up local work, then re-clone "
            "or `git reset --hard @{u}`.")
        return 3
    if code == "diverged":
        log("[geneseed] Your branch has local commits and can't fast-forward — push/rebase "
            "or reset first.")
        return 3
    if code == "ready":
        log(f"[geneseed] {behind} new commit(s) upstream — updating ...")
        ok, fcode, msg = _pull_and_validate(log)
        if not ok:
            log(f"[geneseed] {msg}")
            return 3 if fcode == "collision" else 1
    else:  # uptodate
        log("[geneseed] already up to date.")

    theme = theme_arg or _marker_theme(cfg, out) or config_theme
    # Best-effort rescue, never a gate: a locked file in the stray bundle must
    # not abort the upgrade AFTER the pull has already been applied.
    try:
        _migrate_stray_bundle(here, out, log)
    except OSError as e:
        log(f"[geneseed] ⚠️  could not migrate the old in-folder bundle ({e}) — continuing.")
    rc = _rebuild_bundle(here, out, theme, emit, root_dir, log)
    if rc != 0:
        log(f"[geneseed][E-BUILD] ✗ the bundle build FAILED (theme: {theme or 'default'}, emit: {emit}).")
        return 1
    rc = _rebuild_installs(here, log)
    if rc != 0:
        log("[geneseed][E-BUILD] ✗ one or more installs failed to rebuild — "
            "run `geneseed rebuild-all` to retry (details above).")
        return 1
    log("[geneseed] ✓ upgrade complete." + (f" (full log: {log.path})" if log.path else ""))
    return 0


def sync_self(ref: str | None = None) -> int:
    """A single `git pull` now refreshes the launchers AND the factory together, so
    sync-self is an alias of upgrade (kept for the stable subcommand contract). `ref`
    is accepted for back-compat but ignored (git follows the current branch)."""
    return upgrade()


def main(argv: list[str] | None = None) -> int:
    """Standalone CLI so the launchers can self-heal a STALE factory.

    A partial update (sync-self refreshed the launchers but `upgrade` never refreshed
    rituals/) leaves a new launcher over an old harness.py that has never heard of the
    `upgrade` / `sync-self` subcommands — argparse there hard-fails with "invalid choice".
    The bash / cmd / ps1 front doors probe harness.py and, on a miss, fall back to
    `python rituals/_update.py <cmd>` here, which drives the exact code cmd_upgrade /
    cmd_sync_self call. STABLE CONTRACT — keep `python rituals/_update.py
    {upgrade|sync-self|update} [ref] [theme]` working so future launchers can rely on it.

    Returns a process exit code (0 = ok)."""
    # Standalone entry — harness.py's UTF-8 reconfigure has not run, so force it here
    # or the ✓/⚠️ progress glyphs crash print() on a legacy code page (Windows cp1252).
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            try:
                stream.reconfigure(encoding="utf-8")
            except (ValueError, OSError):
                pass
    argv = list(sys.argv[1:] if argv is None else argv)
    cmd = argv[0] if argv else ""
    # A single `git pull` refreshes launchers + factory, so upgrade/update/sync-self are
    # all the same operation now. A stray positional ref/theme is accepted and ignored.
    if cmd in ("upgrade", "update", "sync-self", "sync_self"):
        return upgrade()
    sys.stderr.write("geneseed self-heal: usage: python rituals/_update.py "
                     "{upgrade|sync-self|update}\n")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
