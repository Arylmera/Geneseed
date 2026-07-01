#!/usr/bin/env python3
"""Cross-platform self-update for Geneseed — a stdlib port of upgrade.sh + sync-self.sh.

The bash scripts depend on `curl`, `unzip`, `find`, `tee`, `grep`, `sort`, `cmp`,
`chmod`, and bash itself — none of which are present on a native Windows shell. This
module re-implements the same two flows using only the Python standard library
(`urllib.request` to download, `zipfile` to extract, `shutil`/`tempfile` for the
filesystem work), so `geneseed upgrade` / `update` / `bootstrap` work identically on
Windows, macOS, and Linux with no external tools.

`harness.py` calls `upgrade()` / `sync_self()` here directly; the `upgrade.sh` and
`sync-self.sh` wrappers now just delegate to `python rituals/harness.py upgrade|sync-self`,
so this module is the single source of truth for the update logic on every platform.

Prefers a shallow `git clone` for the source fetch when `git` is on PATH — it reaches
github.com over the git smart-HTTP protocol, which corporate proxies that block the
codeload.github.com archive zips usually still allow — and falls back to the archive
download below when git is absent or the clone fails (force the old path with
GENESEED_SRC=zip).

Prefers the system `curl` for the archive download (its Happy-Eyeballs IPv4 fallback dodges
the urllib stalls some networks trigger) and drops to stdlib urllib when curl is absent, so
it still runs dependency-free. Behaviour mirrors the scripts it replaces:
  - SHA-pinned archive download (content-addressed, never a mid-publish partial) with a
    ref/tag fallback, retried with exponential backoff.
  - `doctor --all` gate on the downloaded source BEFORE anything local is touched, with
    an early abort when the SAME problems repeat (a real source defect, not CDN lag).
  - copy -> rm -> mv staging so a kill mid-swap never leaves a factory file missing.
  - theme + emit-mode precedence preserved (explicit arg > markers > config > default).
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request
import zipfile
from collections import namedtuple
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import build  # noqa: E402  (path adjusted above)

REPO = "Arylmera/Geneseed"

# Factory files upgrade refreshes from upstream. Everything else in the folder is left
# alone — notably context.json and the bundle's memory/ (host runtime state).
SYNC = ["build.py", "rituals", "src", "themes", "adapters", "web",
        "harness.config.json", "DESIGN.md", "README.md", "SETUP.md", "LICENSE", ".gitignore"]

# Orchestration layer sync-self owns — what upgrade's SYNC deliberately skips, plus the
# native Windows launchers. Refreshing these is what `sync-self` is for.
SCRIPTS = ["upgrade.sh", "sync-self.sh", "geneseed", "bootstrap", "geneseed.cmd", "geneseed.ps1"]

ATTEMPTS = 4

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
        p = subprocess.run(cmd, capture_output=True, text=True,
                           timeout=timeout, env=env, **_NO_WINDOW)
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


def _measure_upstream():
    """Phase B — fetch, then classify. Returns (code, behind, err) where
    code ∈ {ready, fetch_failed, unrelated, diverged, uptodate}."""
    rc, _, err = _git("fetch", "--quiet", timeout=_fetch_timeout(), network=True)
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
    rc, _, err = _git("merge", "--ff-only", "@{u}", timeout=60)
    if rc != 0:
        return (False, "collision",
                "Update blocked — a new upstream file collides with a local untracked "
                "file. Move or remove it, then update.\n" + err)
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


class _UpgradeError(Exception):
    """A tagged, fatal upgrade failure (mirrors the bash `die` codes)."""

    def __init__(self, code: str, msg: str):
        super().__init__(msg)
        self.code = code
        self.msg = msg


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
        print(msg)
        if self.path is not None:
            try:
                with self.path.open("a", encoding="utf-8") as fh:
                    fh.write(msg + "\n")
            except OSError:
                pass


DOCTOR_LEGEND = [
    "[geneseed] doctor problem legend — what the lines above mean / how to fix:",
    "  • 'dead link'          → a skill/agent body links a sibling as <dir>/<name>.md; use the BARE <name>.md (source bug)",
    "  • 'unresolved token'   → a {{TOKEN}} is missing from a theme; add it to ALL 8 theme JSONs",
    "  • 'incomplete source'  → AGENT.md lists a skill whose file isn't in this snapshot (usually a mid-publish cache — retry)",
    "  • 'stale' / 'missing'  → the rendered Harness/ is out of sync (rebuild locally; harmless on a fresh download)",
    "  • 'parity'             → the themes disagree on which tokens exist",
    "  • 'escapes the bundle' → an absolute or ../ path leaked into a rendered file",
]


def _net_timeout() -> float:
    """urllib socket timeout (seconds). Short ON PURPOSE: a macOS IPv6 black-hole or a
    system proxy urllib mishandles makes urlopen() block its FULL timeout in silence — the
    classic stuck "downloading ... attempt 1/4". Failing fast lets curl take over. Override
    with GENESEED_NET_TIMEOUT for a genuinely slow link."""
    try:
        return max(5.0, float(os.environ.get("GENESEED_NET_TIMEOUT", "20")))
    except ValueError:
        return 20.0


def _urlopen(url: str, accept: str | None = None):
    """GET `url` via stdlib urllib — the FALLBACK transport, used only when curl is absent.
    Short timeout so even this path fails fast instead of blocking on a dead socket."""
    headers = {"User-Agent": "geneseed-upgrade"}
    if accept:
        headers["Accept"] = accept
    return urllib.request.urlopen(urllib.request.Request(url, headers=headers),
                                  timeout=_net_timeout())


def _curl_get(url: str, accept: str | None = None, dest: Path | None = None):
    """Fetch via the system `curl` — the PRIMARY transport. Its Happy-Eyeballs IPv4 fallback
    dodges the macOS IPv6 black-hole / mishandled-proxy stalls that make Python's urllib hang
    its full timeout. Returns the response bytes (dest=None), or b"" after writing to `dest`;
    None if curl is absent or the request failed, in which case the caller drops to urllib."""
    exe = shutil.which("curl")
    if not exe:
        return None
    import subprocess
    cmd = [exe, "-fsSL", "--connect-timeout", "10", "--max-time", "180",
           "-A", "geneseed-upgrade"]
    if accept:
        cmd += ["-H", f"Accept: {accept}"]
    if dest is not None:
        cmd += ["-o", str(dest)]
    cmd.append(url)
    try:
        proc = subprocess.run(
            cmd, stdout=(subprocess.DEVNULL if dest is not None else subprocess.PIPE),
            stderr=subprocess.DEVNULL, timeout=190)
    except Exception:
        return None
    if proc.returncode != 0:
        return None
    return b"" if dest is not None else proc.stdout


def _human(n: int) -> str:
    """Bytes as a compact human string (e.g. 1.4 MB) for the live download counter."""
    f = float(n)
    for unit in ("B", "KB", "MB", "GB"):
        if f < 1024 or unit == "GB":
            return f"{int(f)} {unit}" if unit == "B" else f"{f:.1f} {unit}"
        f /= 1024
    return f"{f:.1f} GB"


def _progress(log, got: int, total: int = 0, *, final: bool = False) -> None:
    """Emit one live byte-counter line (no-op without a log). GitHub archives usually omit
    Content-Length, so `total` is often 0 — then we just show the bytes climbing, which is
    all the user needs to see it is alive rather than hung. ASCII only (this runs as a
    subprocess whose stdout may not be UTF-8 on Windows)."""
    if log is None:
        return
    if total > 0:
        body = f"{_human(got)} / {_human(total)} ({min(100, int(got * 100 / total))}%)"
    else:
        body = _human(got)
    log(f"[geneseed]   downloaded {body}" + (" (done)" if final else " ..."))


def _curl_failure_reason(returncode: int, stderr: bytes) -> str:
    """Why curl failed, as one ASCII line: the last non-empty stderr line (`-sS` emits
    e.g. `curl: (35) schannel: ...`), else the bare exit code. ASCII because this can be
    relayed by a subprocess whose stdout is not UTF-8 on Windows (same as _progress)."""
    text = stderr.decode("utf-8", "replace") if stderr else ""
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    reason = lines[-1] if lines else f"exit {returncode}"
    if reason.lower().startswith("curl: "):
        reason = reason[6:]
    return reason.encode("ascii", "replace").decode("ascii")


def _exc_reason(exc: BaseException) -> str:
    """A network exception as one ASCII line (e.g. `HTTP Error 407: Proxy Authentication
    Required`), falling back to the class name when str() is empty."""
    s = " ".join(str(exc).split()) or exc.__class__.__name__
    return s.encode("ascii", "replace").decode("ascii")


def _resolve_sha(ref: str, log=None) -> str | None:
    """The 40-hex commit SHA for `ref` via the GitHub API, or None if unreachable.
    A SHA lets us pull the content-addressed archive/<sha>.zip — which only exists once
    the commit is fully published, never a half-baked snapshot. curl first (it does not
    stall the way urllib can); urllib only if curl is absent."""
    if log is not None:
        log(f"[geneseed] resolving latest commit of {ref} (GitHub API) ...")
    url = f"https://api.github.com/repos/{REPO}/commits/{ref}"
    acc = "application/vnd.github.sha"
    transport = "curl"
    out = _curl_get(url, accept=acc)
    s = out.decode("utf-8", "replace").strip() if out is not None else None
    if not s:
        transport = "urllib"
        try:
            with _urlopen(url, accept=acc) as resp:
                s = resp.read().decode("utf-8", "replace").strip()
        except Exception:
            s = None
    if s and len(s) == 40 and all(c in "0123456789abcdef" for c in s.lower()):
        if log is not None:
            log(f"[geneseed]   -> {s[:12]} (via {transport})")
        return s
    if log is not None:
        log("[geneseed]   -> SHA unresolved; falling back to the branch archive")
    return None


def _curl_download(url: str, dest: Path, log=None):
    """curl -> dest with a live byte counter polled off the growing file. None if curl is
    absent (caller drops to urllib); True/False once it has run."""
    exe = shutil.which("curl")
    if not exe:
        return None
    import subprocess
    # `-sS` keeps stderr down to the one error line, so the PIPE cannot fill and
    # deadlock the poll loop below — and gives _curl_failure_reason its message.
    cmd = [exe, "-fsSL", "-S", "--connect-timeout", "10", "--max-time", "300",
           "-A", "geneseed-upgrade", "-o", str(dest), url]
    try:
        proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    except Exception:
        return None
    last = -1
    while proc.poll() is None:
        try:
            got = dest.stat().st_size
        except OSError:
            got = 0
        if got - last >= 131072:                 # ~every 128 KB, so even a sub-MB file ticks
            _progress(log, got)
            last = got
        time.sleep(0.2)
    err = b""
    if proc.stderr is not None:
        try:
            err = proc.stderr.read()
        finally:
            proc.stderr.close()
    ok = proc.returncode == 0 and dest.is_file() and dest.stat().st_size > 0
    if ok:
        _progress(log, dest.stat().st_size, final=True)
    elif log is not None:
        log(f"[geneseed]   x curl: {_curl_failure_reason(proc.returncode, err)}")
    return ok


def _urllib_download(url: str, dest: Path, log=None) -> bool:
    """urllib -> dest, chunked with a live byte counter (fallback when curl is absent)."""
    try:
        with _urlopen(url) as resp, dest.open("wb") as fh:
            total = int(resp.headers.get("Content-Length") or 0)
            got = last = 0
            while True:
                chunk = resp.read(65536)
                if not chunk:
                    break
                fh.write(chunk)
                got += len(chunk)
                if got - last >= 131072:          # ~every 128 KB, matches the curl path
                    _progress(log, got, total)
                    last = got
    except Exception as e:
        if log is not None:
            log(f"[geneseed]   x urllib: {_exc_reason(e)}")
        return False
    ok = dest.is_file() and dest.stat().st_size > 0
    if ok:
        _progress(log, dest.stat().st_size, final=True)
    return ok


def _download(url: str, dest: Path, log=None) -> bool:
    """Stream `url` to `dest` with a live byte counter. curl first (it does not hang the way
    urllib can); urllib only if curl is absent or failed. True iff a non-empty file landed."""
    if _curl_download(url, dest, log):
        return True
    return _urllib_download(url, dest, log)


def _git_clone_source(ref: str, dest: Path, log=None) -> Path | None:
    """Clone the published source with `git` — the PREFERRED transport when git is on PATH.
    Corporate proxies routinely block the codeload.github.com archive zips
    (`/archive/<sha>.zip`) the download path relies on, while still allowing plain
    git-over-HTTPS to github.com, so a shallow clone gets through where _download cannot.
    Returns the cloned `geneseed-clone` dir, or None — git absent, GENESEED_SRC=zip forces
    the old path, `ref` is a bare commit SHA (`--branch` takes only a branch/tag), or the
    clone failed — in which case the caller drops to the archive-zip download.

    On any failure the partial clone is removed, so it cannot be mistaken for a valid
    `geneseed-*` source by the zip path's extract scan that runs into the same `dest`."""
    if os.environ.get("GENESEED_SRC", "").strip().lower() == "zip":
        return None
    exe = shutil.which("git")
    if not exe:
        return None
    target = dest / "geneseed-clone"
    if target.exists():
        shutil.rmtree(target, ignore_errors=True)
    url = f"https://github.com/{REPO}.git"
    cmd = [exe, "clone", "--depth", "1", "--single-branch", "--branch", ref,
           url, str(target)]
    if log is not None:
        log(f"[geneseed] cloning {REPO}@{ref} (git, shallow) ...")
    try:
        proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                              text=True, timeout=300, **_NO_WINDOW)
    except Exception as e:  # noqa: BLE001 — any spawn/timeout failure -> zip fallback
        if log is not None:
            log(f"[geneseed]   x git clone: {_exc_reason(e)}")
        shutil.rmtree(target, ignore_errors=True)
        return None
    if proc.returncode == 0 and (target / "build.py").is_file():
        if log is not None:
            log(f"[geneseed]   cloned -> {target.name}")
        return target
    if log is not None:
        out = (proc.stdout or "").strip().splitlines()
        reason = out[-1].strip() if out else f"exit {proc.returncode}"
        log(f"[geneseed]   x git clone failed: {reason} - falling back to archive zip")
    shutil.rmtree(target, ignore_errors=True)
    return None


def _fetch_source(ref: str, dest: Path, log=None) -> Path | None:
    """Obtain `ref` as a source tree in `dest`; return the extracted `geneseed-*` dir.
    Prefers a shallow `git clone` (reaches github.com through proxies that block the
    codeload archive zips), falling back to the SHA-pinned archive download — with a
    heads/tags fallback (mirrors fetch_source in upgrade.sh) — when git is absent or the
    clone fails. Logs each sub-step so the progress UI is never silent."""
    cloned = _git_clone_source(ref, dest, log)
    if cloned is not None:
        return cloned
    sha = _resolve_sha(ref, log)
    zip_path = dest / "src.zip"
    sources = []
    if sha:
        sources.append((f"archive {sha[:12]}.zip", f"https://github.com/{REPO}/archive/{sha}.zip"))
    sources.append((f"branch {ref}.zip", f"https://github.com/{REPO}/archive/refs/heads/{ref}.zip"))
    sources.append((f"tag {ref}.zip", f"https://github.com/{REPO}/archive/refs/tags/{ref}.zip"))
    landed = False
    for name, url in sources:
        if log is not None:
            log(f"[geneseed] downloading {name} ...")
        if _download(url, zip_path, log):
            landed = True
            break
        if log is not None:
            log(f"[geneseed]   {name} unavailable - trying next source ...")
    if not landed:
        return None
    if log is not None:
        log("[geneseed] extracting archive ...")
    try:
        with zipfile.ZipFile(zip_path) as zf:
            zf.extractall(dest)
    except (zipfile.BadZipFile, OSError):
        if log is not None:
            log("[geneseed]   x extract failed (corrupt or partial zip)")
        return None
    for child in sorted(dest.iterdir()):
        if child.is_dir() and child.name.lower().startswith("geneseed-"):
            if log is not None:
                log(f"[geneseed]   extracted {child.name}")
            return child
    return None


def _doctor_signature(output: str) -> str:
    """The sorted, de-duplicated set of problem bullet lines — the fingerprint used to
    tell a real source defect (identical every retry) from a mid-publish lag (changes)."""
    bullets = sorted({ln.strip() for ln in output.splitlines()
                      if ln.lstrip().startswith("-")})
    return "\n".join(bullets)


def _run_doctor(cand: Path) -> tuple[bool, str]:
    """Validate a source tree with its OWN `doctor --all --no-bundle` (the bundle is
    rebuilt right after, so its drift is expected). Fail-closed: any nonzero exit,
    timeout, or spawn error is a failure."""
    try:
        proc = subprocess.run(
            [sys.executable, str(cand / "rituals" / "harness.py"),
             "doctor", "--all", "--no-bundle"],
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
            timeout=300, **_NO_WINDOW)
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


def _refresh_item(new_root: Path, here: Path, item: str) -> bool:
    """Stage one factory item with copy -> rm -> mv, shrinking the kill-vulnerable window
    to two instant renames instead of a full-tree copy (parity with upgrade.sh). Returns
    True if the item was refreshed, False if upstream had nothing under that name."""
    src = new_root / item
    if not src.exists():
        return False
    staged = here / f"{item}.geneseed-new"
    dest = here / item
    if staged.exists():
        if staged.is_dir():
            shutil.rmtree(staged)
        else:
            staged.unlink()
    if src.is_dir():
        shutil.copytree(src, staged)
    else:
        shutil.copy2(src, staged)
    if dest.exists():
        if dest.is_dir():
            shutil.rmtree(dest)
        else:
            dest.unlink()
    os.replace(staged, dest)
    return True


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


def _extract_local_zip(zip_path: Path, dest: Path, log=None) -> Path | None:
    """Extract a local offline package (the web UI's /api/offline-zip download, a
    `git archive` of this repo, or a GitHub source zip) into `dest`; return the
    source root inside it — the geneseed-* wrapper dir when the zip has one, else
    `dest` itself when build.py sits at the top level."""
    try:
        with zipfile.ZipFile(zip_path) as zf:
            zf.extractall(dest)
    except (zipfile.BadZipFile, OSError):
        if log is not None:
            log("[geneseed]   x extract failed (corrupt or partial zip)")
        return None
    for child in sorted(dest.iterdir()):
        if child.is_dir() and child.name.lower().startswith("geneseed-"):
            return child
    return dest if (dest / "build.py").is_file() else None


def _local_zip_source(zip_arg: str, tmp: Path, log: _Log) -> Path:
    """Offline counterpart of _fetch_and_validate: extract + doctor-gate a local
    package. Returns the validated source dir, or raises _UpgradeError."""
    zp = Path(zip_arg).expanduser()
    if not zp.is_file():
        raise _UpgradeError("E-ZIP", f"offline package not found: {zp}")
    log(f"[geneseed] using offline package {zp} ...")
    work = tmp / "offline"
    work.mkdir(parents=True, exist_ok=True)
    cand = _extract_local_zip(zp, work, log)
    if cand is None or not cand.is_dir():
        raise _UpgradeError("E-ZIP", f"could not extract a source tree from {zp}")
    log("[geneseed] validating offline source (doctor --all) ...")
    passed, output = _run_doctor(cand)
    log(output.rstrip("\n"))
    if not passed:
        raise _UpgradeError(
            "E-DOCTOR",
            "the offline package FAILS validation — it was built from a defective "
            "source. Re-download it from a checkout whose doctor passes.")
    return cand


def upgrade(ref: str | None = None, theme_arg: str | None = None,
            zip_arg: str | None = None) -> int:
    """Port of upgrade.sh: download the published source (or, with `zip_arg`, use a
    local offline package instead of the network), refresh the factory files in
    this folder, and re-render the bundle. Returns a process exit code (0 = ok)."""
    log = _Log()
    here = ROOT
    ref = ref or "main"
    out = Path(os.environ.get("GENESEED_OUT") or (here.parent / "Harness"))
    root_dir = Path(os.environ.get("GENESEED_ROOT") or out.parent)
    cfg = _opencode_config_dir()
    emit = _resolve_emit(cfg, out)

    if emit == "files" and (cfg / ".geneseed-manifest.json").is_file():
        sys.stderr.write(
            f"[geneseed] ⚠️  {cfg} already holds a global Geneseed install (.geneseed-manifest.json),\n"
            f"[geneseed] ⚠️  but this run emits the plain bundle only — it will NOT refresh that global config.\n"
            f"[geneseed] ⚠️  Did you mean:  GENESEED_EMIT=opencode-global geneseed upgrade {ref}\n")

    tmp = Path(tempfile.mkdtemp(prefix="geneseed-"))
    try:
        try:
            new_root = _local_zip_source(zip_arg, tmp, log) if zip_arg \
                else _fetch_and_validate(ref, tmp, log)
        except _UpgradeError as e:
            for line in DOCTOR_LEGEND:
                log(line)
            log(f"[geneseed][{e.code}] ✗ {e.msg}")
            if log.path is not None:
                log(f"[geneseed] ── full install log: {log.path}")
            return 1

        config_theme = _config_theme(here)

        log(f"[geneseed] refreshing factory files in {here} ...")
        for item in SYNC:
            if _refresh_item(new_root, here, item):
                log(f"[geneseed]   refreshed {item}")

        theme = theme_arg or _marker_theme(cfg, out) or config_theme
        if not theme:
            sys.stderr.write(
                f"[geneseed] ⚠️  no theme found — no marker at {out}/.geneseed-theme, no local config theme.\n"
                f"[geneseed] ⚠️  falling back to the upstream default. Pin it explicitly to avoid a silent downgrade:\n"
                f"[geneseed] ⚠️      geneseed upgrade {ref} imperial\n")

        build_args = ["--out", str(out)]
        if theme:
            build_args += ["--theme", theme]
        if emit == "opencode":
            build_args += ["--emit", "opencode", "--root", str(root_dir)]
        elif emit == "opencode-global":
            build_args += ["--emit", "opencode-global"]

        _migrate_stray_bundle(here, out, log)

        log(f"[geneseed] rebuilding bundle -> {out} (theme: {theme or 'config default'}, emit: {emit}) ...")
        import subprocess
        proc = subprocess.run([sys.executable, str(here / "build.py"), *build_args],
                              cwd=str(here))
        if proc.returncode != 0:
            log(f"[geneseed][E-BUILD] ✗ the bundle build FAILED (theme: {theme or 'default'}, emit: {emit}).")
            if log.path is not None:
                log(f"[geneseed] ── full install log: {log.path}")
            return 1

        # If a web daemon is running, bounce it so the new rituals/* source and
        # the freshly rebuilt web/dist take effect — otherwise the open PWA keeps
        # hitting the old code and unknown new API routes fall back to index.html
        # (yielding the cryptic "string did not match the expected pattern" JSON
        # parse error in the browser).
        try:
            sys.path.insert(0, str(here / "rituals"))
            import web as _web  # noqa: E402
            _web.restart_daemon(theme=theme, open_browser=False, only_if_running=True)
        except Exception as e:  # noqa: BLE001  — never fail an upgrade on this
            log(f"[geneseed] ⚠️  could not refresh the web daemon ({e}) — `geneseed web restart` manually if it was running.")

        log("[geneseed] ✓ upgrade complete." + (f" (full log: {log.path})" if log.path else ""))
        return 0
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def _fetch_and_validate(ref: str, tmp: Path, log: _Log) -> Path:
    """Download + doctor-gate the source, retrying on a mid-publish lag. Returns the
    validated extracted dir, or raises _UpgradeError."""
    delay = 2
    prev_sig = ""
    for i in range(1, ATTEMPTS + 1):
        work = tmp / f"try{i}"
        work.mkdir(parents=True, exist_ok=True)
        log(f"[geneseed] downloading {REPO}@{ref} (attempt {i}/{ATTEMPTS}) ...")
        cand = _fetch_source(ref, work, log)
        if cand is None or not cand.is_dir():
            log(f"[geneseed][E-DOWNLOAD] ⚠️  download or extract failed (attempt {i}/{ATTEMPTS}) — check network.")
            if i < ATTEMPTS:
                time.sleep(delay)
                delay *= 2
            continue
        log("[geneseed] validating downloaded source (doctor --all) ...")
        passed, output = _run_doctor(cand)
        log(output.rstrip("\n"))
        if passed:
            return cand
        sig = _doctor_signature(output)
        if sig and sig == prev_sig:
            raise _UpgradeError(
                "E-DOCTOR",
                "the downloaded source FAILS validation with the SAME problems twice — this is a "
                "SOURCE DEFECT, not a publish-cache lag. Fix the problems listed above; retrying will not help.")
        prev_sig = sig
        log(f"[geneseed] ⚠️  validation failed (attempt {i}/{ATTEMPTS}) — may be a mid-publish cache; retrying ...")
        if i < ATTEMPTS:
            time.sleep(delay)
            delay *= 2
    raise _UpgradeError(
        "E-NOSRC",
        f"could not obtain a source that passes validation after {ATTEMPTS} attempts. If the problems "
        f"repeat it is a SOURCE bug; if they differ or mention 'incomplete', upstream may still be "
        f"publishing — retry shortly, or pin a tag:  geneseed upgrade v<x.y.z>")


def sync_self(ref: str | None = None) -> int:
    """Port of sync-self.sh: refresh the orchestration scripts (the launchers + update
    scripts) that `upgrade` deliberately does not touch. Safe to overwrite the bash/PS
    launchers mid-run — this is a Python process, it does not re-read them by byte offset."""
    here = ROOT
    ref = ref or "main"
    log = print
    log(f"[geneseed] fetching orchestration scripts from {REPO}@{ref} ...")
    tmp = Path(tempfile.mkdtemp(prefix="geneseed-sync-"))
    try:
        new_root = None
        delay = 2
        for i in range(1, ATTEMPTS + 1):
            for stale in tmp.glob("geneseed-*"):
                shutil.rmtree(stale, ignore_errors=True)
            (tmp / "src.zip").unlink(missing_ok=True)
            new_root = _fetch_source(ref, tmp, log)
            if new_root is not None:
                break
            sys.stderr.write(f"[geneseed]   download attempt {i} failed — retrying ...\n")
            if i < ATTEMPTS:
                time.sleep(delay)
                delay *= 2
        if new_root is None:
            sys.stderr.write(f"[geneseed] download failed for ref '{ref}' after retries\n")
            return 1

        changed = 0
        for name in SCRIPTS:
            src = new_root / name
            if not src.is_file():
                continue
            dest = here / name
            if dest.is_file() and src.read_bytes() == dest.read_bytes():
                continue
            shutil.copy2(src, dest)
            if not sys.platform.startswith("win") and not name.lower().endswith((".cmd", ".ps1")):
                # Restore the executable bit Unix needs on the launcher/scripts. (NTFS has
                # no exec bit; .cmd/.ps1 are run by their interpreter, not chmod-gated.)
                mode = dest.stat().st_mode
                dest.chmod(mode | 0o111)
            print(f"[geneseed]   updated {name}")
            changed += 1

        if changed == 0:
            print(f"[geneseed] orchestration scripts already up to date ({ref}).")
        else:
            print(f"[geneseed] refreshed {changed} script(s). Now run: geneseed upgrade")
        return 0
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


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
    rest = [a for a in argv[1:] if a not in ("-h", "--help")]
    zip_arg = None
    if "--zip" in rest:                     # offline package: --zip <file>
        i = rest.index("--zip")
        zip_arg = rest[i + 1] if i + 1 < len(rest) else None
        rest = rest[:i] + rest[i + 2:]
        if not zip_arg:
            sys.stderr.write("geneseed self-heal: --zip needs a file path\n")
            return 2
    if cmd == "upgrade":
        return upgrade(rest[0] if len(rest) > 0 else None,
                       rest[1] if len(rest) > 1 else None,
                       zip_arg=zip_arg)
    if cmd in ("sync-self", "sync_self"):
        return sync_self(rest[0] if rest else None)
    if cmd == "update":  # orchestration first, THEN the factory — mirrors `geneseed update`
        ref = rest[0] if rest else None
        rc = sync_self(ref)
        return rc if rc else upgrade(ref)
    sys.stderr.write("geneseed self-heal: usage: python rituals/_update.py "
                     "{upgrade|sync-self|update} [ref] [theme]\n")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
