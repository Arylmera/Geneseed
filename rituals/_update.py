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

Stdlib only. No dependencies. Behaviour mirrors the scripts it replaces:
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
import shutil
import sys
import tempfile
import time
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import build  # noqa: E402  (path adjusted above)

REPO = "Arylmera/Geneseed"

# Factory files upgrade refreshes from upstream. Everything else in the folder is left
# alone — notably context.json and the bundle's memory/ (host runtime state).
SYNC = ["build.py", "rituals", "src", "themes", "adapters", "prompts",
        "harness.config.json", "DESIGN.md", "README.md", "SETUP.md", "LICENSE", ".gitignore"]

# Orchestration layer sync-self owns — what upgrade's SYNC deliberately skips, plus the
# native Windows launchers. Refreshing these is what `sync-self` is for.
SCRIPTS = ["upgrade.sh", "sync-self.sh", "geneseed", "bootstrap", "geneseed.cmd", "geneseed.ps1"]

ATTEMPTS = 4


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


def _urlopen(url: str, accept: str | None = None):
    """GET `url` with a User-Agent (GitHub rejects requests without one)."""
    headers = {"User-Agent": "geneseed-upgrade"}
    if accept:
        headers["Accept"] = accept
    return urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=60)


def _resolve_sha(ref: str) -> str | None:
    """The 40-hex commit SHA for `ref` via the GitHub API, or None if unreachable.
    A SHA lets us pull the content-addressed archive/<sha>.zip — which only exists once
    the commit is fully published, never a half-baked snapshot."""
    try:
        with _urlopen(f"https://api.github.com/repos/{REPO}/commits/{ref}",
                      accept="application/vnd.github.sha") as resp:
            s = resp.read().decode("utf-8", "replace").strip()
    except Exception:
        return None
    if len(s) == 40 and all(c in "0123456789abcdef" for c in s.lower()):
        return s
    return None


def _download(url: str, dest: Path) -> bool:
    try:
        with _urlopen(url) as resp, dest.open("wb") as fh:
            shutil.copyfileobj(resp, fh)
        return True
    except Exception:
        return False


def _fetch_source(ref: str, dest: Path) -> Path | None:
    """Download + extract `ref` into `dest`; return the extracted `geneseed-*` dir.
    SHA-pinned with a heads/tags fallback (mirrors fetch_source in upgrade.sh)."""
    sha = _resolve_sha(ref)
    zip_path = dest / "src.zip"
    urls = []
    if sha:
        urls.append(f"https://github.com/{REPO}/archive/{sha}.zip")
    urls.append(f"https://github.com/{REPO}/archive/refs/heads/{ref}.zip")
    urls.append(f"https://github.com/{REPO}/archive/refs/tags/{ref}.zip")
    if not any(_download(u, zip_path) for u in urls):
        return None
    try:
        with zipfile.ZipFile(zip_path) as zf:
            zf.extractall(dest)
    except (zipfile.BadZipFile, OSError):
        return None
    for child in sorted(dest.iterdir()):
        if child.is_dir() and child.name.lower().startswith("geneseed-"):
            return child
    return None


def _doctor_signature(output: str) -> str:
    """The sorted, de-duplicated set of problem bullet lines — the fingerprint used to
    tell a real source defect (identical every retry) from a mid-publish lag (changes)."""
    bullets = sorted({ln.strip() for ln in output.splitlines()
                      if ln.lstrip().startswith("-")})
    return "\n".join(bullets)


def _run_doctor(cand: Path) -> tuple[bool, str]:
    """Validate a downloaded source with its OWN `doctor --all` (so the gate checks the
    source about to be applied). Returns (passed, combined_output)."""
    import subprocess
    proc = subprocess.run(
        [sys.executable, str(cand / "rituals" / "harness.py"), "doctor", "--all"],
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    return proc.returncode == 0, proc.stdout or ""


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


def _refresh_item(new_root: Path, here: Path, item: str) -> None:
    """Stage one factory item with copy -> rm -> mv, shrinking the kill-vulnerable window
    to two instant renames instead of a full-tree copy (parity with upgrade.sh)."""
    src = new_root / item
    if not src.exists():
        return
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


def upgrade(ref: str | None = None, theme_arg: str | None = None) -> int:
    """Port of upgrade.sh: download the published source, refresh the factory files in
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
            new_root = _fetch_and_validate(ref, tmp, log)
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
            _refresh_item(new_root, here, item)

        marker_theme = ""
        try:
            marker_theme = (out / ".geneseed-theme").read_text(encoding="utf-8").strip()
        except OSError:
            pass
        theme = theme_arg or marker_theme or config_theme
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
        cand = _fetch_source(ref, work)
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
            new_root = _fetch_source(ref, tmp)
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
    argv = list(sys.argv[1:] if argv is None else argv)
    cmd = argv[0] if argv else ""
    rest = [a for a in argv[1:] if a not in ("-h", "--help")]
    if cmd == "upgrade":
        return upgrade(rest[0] if len(rest) > 0 else None,
                       rest[1] if len(rest) > 1 else None)
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
