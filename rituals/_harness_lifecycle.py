"""Geneseed harness — bootstrap / upgrade / sync-self / link — the self-update layer.

Part of the harness CLI (see harness.py). Imports the shared toolset from
_harness_core; cross-submodule names are linked at import time by harness.py,
so this file is only ever used through `import harness`."""
from __future__ import annotations

from _harness_core import *  # noqa: F401,F403  shared stdlib + primitives



# ---- bootstrap: update everything with a curses progress screen, then setup -------

ANSI_RE = re.compile(r"\x1b\[[0-9;?]*[ -/]*[@-~]")


def _clean_line(s: str) -> str:
    """Strip ANSI escapes and control characters from streamed subprocess output so
    they can't garble the curses log pane."""
    s = ANSI_RE.sub("", s)
    return "".join(ch if (ch == "\t" or ord(ch) >= 32) else " " for ch in s)


def _bootstrap_draw(stdscr, curses, pal, steps, status, log, heading="updating") -> None:
    _clear_frame(stdscr)   # full repaint so a narrowing spinner leaves no double-width ghost
    h, w = stdscr.getmaxyx()

    def put(y, x, s, a=0):
        _put(stdscr, y, x, s, a)

    # Plain layout (no box-drawing frame) — matches the doctor progress screen, which
    # renders cleanly; the ACS frame showed as tofu in some terminal fonts.
    _topbar(stdscr, pal, f"Geneseed — {heading}")
    _bootstrap_draw.tick = getattr(_bootstrap_draw, "tick", 0) + 1
    tick = _bootstrap_draw.tick

    def step_mark(st):
        if st == "running":
            return _spin(tick)
        return {"pending": _mark("pending"), "done": _mark("ok"),
                "failed": _mark("fail")}.get(st, _mark("pending"))
    for i, (title, _c) in enumerate(steps):
        st = status[i]
        attr = pal["HEAD"] if st == "running" else (curses.A_DIM if st == "pending" else 0)
        # _fit the mark to a fixed 2 columns so a width-2 emoji mark and a width-1 dot
        # leave every step title starting at the same column (no per-row jitter).
        put(2 + i, 3, f"{_fit(step_mark(st), 2)} {title}", attr)
    done = sum(1 for s in status if s in ("done", "failed"))
    w_bar = max(10, min(40, w - 22))
    put(2 + len(steps) + 1, 3,
        f"[{_progress_bar(done / len(steps) if steps else 0.0, w_bar)}] {done}/{len(steps)}",
        pal["HEAD"])
    top = 2 + len(steps) + 3
    put(top, 3, "output:", pal["HEAD"])
    inner = max(0, h - top - 2)
    for j, ln in enumerate(log[-inner:]):
        put(top + 1 + j, 3, ln[:w - 4], curses.A_DIM)
    _botbar(stdscr, pal, f"{_spin(tick)} working… please wait")
    stdscr.refresh()


def _pipe_select_ok() -> bool:
    """Whether select() can poll the subprocess pipe. On Windows select() is WinSock-only
    — handing it a pipe fd raises OSError — so Windows always streams plainly instead."""
    import select
    return hasattr(select, "select") and not sys.platform.startswith("win")


def _install_logfile() -> Path | None:
    """The persistent install log `_update.py` writes to — so a failed in-process update
    step lands its diagnosis in the SAME file a real `upgrade` run logs to, giving the user
    one place to read regardless of which path failed. Honours $GENESEED_LOG. None only if
    even the fallback is unwritable."""
    try:
        import _update
        return _update._logfile()
    except Exception:
        return Path.home() / ".geneseed-install.log"


def _stale_factory_hint(output: str, sub: str, ref: str) -> list[str]:
    """If `output` is argparse's 'invalid choice' reject for the self-update subcommand
    `sub`, return the targeted cure; else []. This is the partial-update skew behind the
    field report: step 1/2 (sync-self) refreshed the launchers + _update.py, but the factory
    (rituals/harness.py) is still too old to know `upgrade`/`sync-self`, so step 2/2 dies in
    argparse before `_update` is ever reached. The launchers self-heal via _update.py; this
    points a manual run at the same cure."""
    low = (output or "").lower()
    if not (sub and "invalid choice" in low and sub in low):
        return []
    return [
        f"[geneseed]   diagnosis: the installed rituals/harness.py PREDATES the '{sub}' subcommand.",
        "[geneseed]   step 1/2 refreshed the launchers + _update.py, but the factory is still old —",
        f"[geneseed]   so step 2/2 'harness.py {sub}' hit argparse 'invalid choice'. Self-heal directly:",
        f"[geneseed]     python rituals/_update.py update {ref}",
    ]


def _diagnose_failed_step(n: int, total: int, title: str, cmd: list,
                          rc: int, output: str) -> list[str]:
    """Build — and persist to the install log — the diagnosis for a failed update step.
    Returns the human lines to ALSO surface live (progress pane / stdout). `output` is the
    step's captured combined output (curses path) or a captured re-probe (plain path); it is
    scanned for the stale-factory signature. Persisting matters: the curses log pane is
    ephemeral and the plain path's child output scrolls past, so without this the only trace
    of WHY a step failed is gone the moment the screen tears down."""
    sub = cmd[2] if len(cmd) > 2 else ""
    ref = cmd[3] if len(cmd) > 3 else "main"
    lines = [f"[geneseed] ✗ step {n}/{total} FAILED (exit {rc}): {title}"]
    lines += _stale_factory_hint(output, sub, ref)
    logpath = _install_logfile()
    if logpath is not None:
        try:
            with logpath.open("a", encoding="utf-8") as fh:
                fh.write(f"\n==== geneseed update: step {n}/{total} '{title}' FAILED (exit {rc}) ====\n")
                fh.write("command: " + " ".join(str(c) for c in cmd) + "\n")
                if output.strip():
                    fh.write(output.rstrip("\n") + "\n")
                for ln in lines[1:]:
                    fh.write(ln + "\n")
            lines.append(f"[geneseed] ── full install log: {logpath}")
        except OSError:
            pass
    return lines


def _harness_supports(hp: str, sub: str) -> bool:
    """True iff this harness.py knows subcommand `sub`. A side-effect-free `--help` exits 0
    only when the subparser exists — argparse rejects an unknown choice with exit 2. This is
    the same probe the launchers use to detect a stale factory."""
    try:
        pr = subprocess.run([sys.executable, hp, sub, "--help"],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                            timeout=30, **NO_WINDOW)
        return pr.returncode == 0
    except (OSError, subprocess.TimeoutExpired):
        return False


def _update_step_cmd(here: Path, sub: str) -> list:
    """The command for one update step, self-healing a STALE factory. Prefer the in-tree
    `harness.py <sub>`; but when harness.py predates it — the partial-update skew that breaks
    with argparse 'invalid choice' — drop to `rituals/_update.py <sub>`, the exact same code
    path (and the same fallback the launchers use). So an update started from a stale factory
    now REPAIRS itself in-process instead of dead-ending."""
    hp = str(here / "rituals" / "harness.py")
    if _harness_supports(hp, sub):
        return [sys.executable, hp, sub]
    return [sys.executable, str(here / "rituals" / "_update.py"), sub]


def _run_logged(stdscr, curses, pal, steps, status, log, cmd, heading="updating") -> int:
    """Run cmd, streaming its (sanitized) output into the progress screen's log pane."""
    try:
        # Decode as UTF-8 regardless of the console code page: the children (harness.py,
        # build.py) reconfigure THEIR stdout to UTF-8, and a cp1252-strict wrapper dies
        # on the first ⚠️/✓ they emit. errors="replace" keeps a stray byte cosmetic.
        p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                             text=True, encoding="utf-8", errors="replace", bufsize=1)
    except OSError as e:
        log.append(f"[error] cannot run {cmd[0]}: {e}")
        _bootstrap_draw(stdscr, curses, pal, steps, status, log, heading)
        return 1
    import time
    import select
    last = 0.0

    def _emit_lines(buf: str) -> str:
        while "\n" in buf:
            line, buf = buf.split("\n", 1)
            log.append(_clean_line(line))
            if len(log) > 400:
                del log[: len(log) - 400]
        return buf

    fd = p.stdout.fileno() if p.stdout else None
    if fd is not None and _pipe_select_ok():
        # Poll the pipe with an 80 ms timeout so the screen redraws — and the spinner
        # advances — even while a step produces NO output (the silent-step freeze). Only
        # this main thread touches curses; os.read on the raw fd gives a clean EOF.
        buf = ""
        while True:
            r, _w, _e = select.select([fd], [], [], 0.08)
            if r:
                try:
                    chunk = os.read(fd, 4096)
                except OSError:
                    chunk = b""
                if not chunk:
                    break                       # subprocess closed stdout → done
                buf = _emit_lines(buf + chunk.decode("utf-8", "replace"))
            now = time.monotonic()
            if (not r) or now - last > 0.06:     # tick on idle; throttle on busy output
                _bootstrap_draw(stdscr, curses, pal, steps, status, log, heading)
                last = now
        if buf:
            log.append(_clean_line(buf))
    else:                                        # no pipe select (non-Unix) — stream plainly
        for line in p.stdout or []:
            log.append(_clean_line(line.rstrip("\n")))
            if len(log) > 400:
                del log[: len(log) - 400]
            now = time.monotonic()
            if now - last > 0.06:
                _bootstrap_draw(stdscr, curses, pal, steps, status, log, heading)
                last = now
    _bootstrap_draw(stdscr, curses, pal, steps, status, log, heading)   # final frame
    if p.stdout is not None:
        p.stdout.close()
    return p.wait()


def _run_steps(stdscr, curses, pal, steps, heading="working") -> list:
    """Run each (title, cmd) step in the progress UI; return the per-step status list."""
    status = ["pending"] * len(steps)
    log: list[str] = []
    for i, (title, cmd) in enumerate(steps):
        status[i] = "running"
        _bootstrap_draw(stdscr, curses, pal, steps, status, log, heading)
        rc = _run_logged(stdscr, curses, pal, steps, status, log, cmd, heading)
        # Exit 3 is an info precondition (dirty tree / no upstream / already up to date) —
        # nothing to do, not a failure.
        status[i] = "done" if rc in (0, 3) else "failed"
        if rc not in (0, 3):
            # The pane scrolls and curses tears down on exit — capture WHY to the install
            # log and surface the diagnosis (incl. the stale-factory cure) in the pane.
            for ln in _diagnose_failed_step(i + 1, len(steps), title, cmd, rc, "\n".join(log)):
                log.append(ln)
        _bootstrap_draw(stdscr, curses, pal, steps, status, log, heading)
    return status


def _bootstrap_progress(stdscr, here, ref) -> bool:
    """Returns True when a step FAILED (curses.wrapper passes it through)."""
    import curses
    pal = _tui_palette(curses)
    curses.curs_set(0)
    # One `git pull` refreshes launchers + factory together, then rebuilds — a single step.
    steps = [("Update & rebuild", _update_step_cmd(here, "upgrade"))]
    status = _run_steps(stdscr, curses, pal, steps, heading="updating")
    failed = any(s == "failed" for s in status)
    msg = ("a step FAILED — press any key to continue to setup" if failed
           else "update complete — continuing to setup…")
    _botbar(stdscr, pal, msg)
    stdscr.refresh()
    if failed:
        stdscr.getch()          # pause so the error is readable
    else:
        curses.napms(700)       # brief beat, then continue automatically
    return failed


def _bootstrap_plain(here, ref) -> bool:
    """Non-curses fallback: run the update (git pull + rebuild) with plain output (never
    fatal). Cross-platform — invokes the harness's own Python `upgrade` subcommand (no bash),
    so this works identically on native Windows. Exit 3 (an info precondition like a dirty
    tree or already-up-to-date) is reported as skipped, not failed; a real failure reports the
    exit code and (for the stale-factory skew) the exact self-heal command. Returns True
    when a step FAILED, so scripted callers get a real exit code."""
    # One `git pull` refreshes launchers + factory together, then rebuilds — a single step.
    steps = [("Update & rebuild", _update_step_cmd(here, "upgrade"))]
    failed = False
    for i, (title, cmd) in enumerate(steps):
        print(f"[geneseed] step {i + 1}/{len(steps)}: {title} ...")
        rc = run(cmd).returncode
        if rc not in (0, 3):
            failed = True
            # The live run inherited stdout, so its output was not captured. Re-probe the
            # subcommand (captured) to confirm the stale-factory signature for the diagnosis.
            hp = str(here / "rituals" / "harness.py")
            sub = cmd[2] if len(cmd) > 2 else ""
            probe = ""
            if sub in ("upgrade", "sync-self"):
                pr = subprocess.run([sys.executable, hp, sub, "--help"],
                                    stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                    text=True, encoding="utf-8", errors="replace")
                if pr.returncode != 0:
                    probe = pr.stdout or ""
            for ln in _diagnose_failed_step(i + 1, len(steps), title, cmd, rc, probe):
                print(ln)
    if not failed:
        print("[geneseed] ✓ update complete.")
    return failed


def cmd_upgrade(args: argparse.Namespace) -> int:
    """Self-upgrade from the install's own git origin, then rebuild the bundle.
    Cross-platform (git pull + rebuild) — the shell wrappers all delegate here.
    Before anything is refreshed, any drift in the deployed global harness (the
    self-improvement loops edit it in place) is exported to an improvements file —
    the rebuild overwrites those edits, and the export must compare against the
    PRE-refresh source the deployment was built from."""
    try:
        ipath, _ = export_improvements()
        if ipath:
            print(f"[upgrade] deployed harness carries local edits — saved to {ipath}")
            print("[upgrade] hand that file to your agent to back-port them into src/.")
    except Exception as e:                  # never block an upgrade on the export
        sys.stderr.write(f"[upgrade] ⚠️  could not export local edits ({e}) — "
                         f"run `geneseed diff --out FILE` before upgrading to keep them.\n")
    import _update
    ref, theme = args.ref, args.theme
    # Back-compat: the legacy hidden [ref] positional eats the FIRST arg, so
    # `geneseed upgrade imperial` lands in ref (which _update ignores) and the
    # theme silently drops. ref is dead — reinterpret it as the theme when it
    # names one.
    if theme is None and ref and (ROOT / "themes" / f"{ref}.json").is_file():
        ref, theme = None, ref
    return _update.upgrade(ref, theme)


def cmd_sync_self(args: argparse.Namespace) -> int:
    """Refresh the orchestration layer (launchers + update scripts) that `upgrade` does
    not touch. Cross-platform — replaces sync-self.sh; the wrapper now delegates here."""
    import _update
    return _update.sync_self(args.ref)


# --- run-from-anywhere (link/unlink): cross-platform PATH install ------------------
# Unix symlinks the launcher into a bin dir; Windows writes a small `geneseed.cmd` shim
# into a dedicated dir and puts THAT on the user PATH (no admin/Dev-Mode symlink needed).

def _win_bin_dir() -> Path:
    base = os.environ.get("LOCALAPPDATA") or str(Path.home())
    return Path(base) / "Geneseed" / "bin"


def _win_user_path(action: str, directory: str) -> bool:
    """Add/remove `directory` from the persistent USER Path via PowerShell (operates on
    the user scope only, so it never truncates the system PATH). Returns success."""
    directory = directory.replace("'", "''")   # PS single-quote escape (O'Brien)
    if action == "add":
        ps = (f"$d='{directory}';"
              "$p=[Environment]::GetEnvironmentVariable('Path','User');"
              "if (-not $p) {$p=''};"
              "$parts=$p.Split(';') | Where-Object {$_ -ne ''};"
              "if ($parts -notcontains $d) {"
              "  $np=(@($parts)+$d) -join ';';"
              "  [Environment]::SetEnvironmentVariable('Path',$np,'User')}")
    else:
        ps = (f"$d='{directory}';"
              "$p=[Environment]::GetEnvironmentVariable('Path','User');"
              "if ($p) {"
              "  $np=(($p.Split(';') | Where-Object {$_ -ne '' -and $_ -ne $d}) -join ';');"
              "  [Environment]::SetEnvironmentVariable('Path',$np,'User')}")
    try:
        return run(["powershell", "-NoProfile", "-Command", ps]).returncode == 0
    except OSError:
        return False


def cmd_link(args: argparse.Namespace) -> int:
    """Put `geneseed` on PATH so it runs from any directory."""
    here = ROOT
    if sys.platform.startswith("win"):
        bindir = _win_bin_dir()
        shim = bindir / "geneseed.cmd"
        try:
            bindir.mkdir(parents=True, exist_ok=True)
            # The running interpreter, not bare `python` — which may be missing
            # from PATH or resolve to the Microsoft Store alias stub.
            shim.write_text(
                "@echo off\r\n"
                f'"{sys.executable}" "{here / "rituals" / "harness.py"}" %*\r\n',
                encoding="utf-8")
        except OSError as e:
            print(f"geneseed: could not write {shim} ({e})", file=sys.stderr)
            return 1
        print(f"geneseed: wrote shim {shim}")
        on_path = str(bindir).lower() in (os.environ.get("PATH") or "").lower()
        if on_path or _win_user_path("add", str(bindir)):
            print(f"geneseed: '{bindir}' is on your user PATH — open a NEW terminal, then run `geneseed`.")
        else:
            print(f"geneseed: add '{bindir}' to your PATH manually, then run `geneseed` from anywhere.")
        return 0
    # Unix: symlink the launcher into a bin dir (default ~/.local/bin, no sudo).
    target_dir = Path(args.dir) if getattr(args, "dir", None) else None
    if target_dir is None:
        local = Path.home() / ".local" / "bin"
        try:
            local.mkdir(parents=True, exist_ok=True)
            target_dir = local
        except OSError:
            target_dir = Path("/usr/local/bin")
    dest = target_dir / "geneseed"
    try:
        target_dir.mkdir(parents=True, exist_ok=True)
        if dest.is_symlink() or dest.exists():
            dest.unlink()
        dest.symlink_to(here / "geneseed")
    except OSError as e:
        print(f"geneseed: could not write {dest} ({e}) — pick a writable dir: "
              f"geneseed link <dir>", file=sys.stderr)
        return 1
    print(f"geneseed: linked {dest} -> {here / 'geneseed'}")
    if str(target_dir) in (os.environ.get("PATH") or "").split(os.pathsep):
        print(f"geneseed: '{target_dir}' is on PATH — run 'geneseed' from anywhere.")
    else:
        print(f"geneseed: NOTE '{target_dir}' is not on your PATH. Add it, e.g.:")
        print(f"  echo 'export PATH=\"{target_dir}:$PATH\"' >> ~/.zshrc   # or ~/.bashrc")
    return 0


def cmd_unlink(args: argparse.Namespace) -> int:
    """Remove the `geneseed` launcher from PATH (the symlink on Unix / shim + PATH entry
    on Windows)."""
    if sys.platform.startswith("win"):
        bindir = _win_bin_dir()
        shim = bindir / "geneseed.cmd"
        removed = False
        if shim.exists():
            try:
                shim.unlink()
                removed = True
                print(f"geneseed: removed {shim}")
            except OSError as e:
                print(f"geneseed: could not remove {shim} ({e})", file=sys.stderr)
        if _win_user_path("remove", str(bindir)):
            print(f"geneseed: removed '{bindir}' from your user PATH (open a new terminal).")
        if not removed:
            print("geneseed: no linked launcher found.")
        return 0
    removed = False
    candidates = [Path.home() / ".local" / "bin", Path("/usr/local/bin")]
    candidates += [Path(d) for d in (os.environ.get("PATH") or "").split(os.pathsep) if d]
    seen: set[Path] = set()
    for d in candidates:
        if d in seen:
            continue
        seen.add(d)
        f = d / "geneseed"
        if f.is_symlink() and Path(os.readlink(f)).name == "geneseed":
            try:
                f.unlink()
                print(f"geneseed: removed {f}")
                removed = True
            except OSError:
                pass
    if not removed:
        print("geneseed: no linked launcher found on PATH")
    return 0


def _reexec(argv: list) -> None:
    """Hand off to a FRESH harness process (so just-updated code on disk runs, not the
    stale modules this process still holds). Unix execv truly replaces the process.
    Windows has no exec — os.execv there spawns the child and kills this parent, which
    hands the console back to the launcher's cmd.exe mid-run and the two then fight
    over input — so run the child as a normal subprocess and exit with its code."""
    if sys.platform.startswith("win"):
        raise SystemExit(subprocess.run(argv).returncode)
    os.execv(argv[0], argv)


def cmd_bootstrap(args: argparse.Namespace) -> int:
    """Update everything (sync scripts + upgrade), shown in a curses progress screen
    where supported, then hand off to a FRESH setup process so the wizard runs the
    just-updated code. `--no-setup` stops after the update."""
    here = Path(__file__).resolve().parent.parent
    failed = False
    if sys.stdin.isatty():
        try:
            import curses
            import locale
            try:
                locale.setlocale(locale.LC_ALL, "")
            except locale.Error:
                pass
            failed = bool(curses.wrapper(_bootstrap_progress, here, args.ref))
        except Exception as e:
            sys.stderr.write(f"[bootstrap] progress UI unavailable ({e}); running plainly.\n")
            failed = _bootstrap_plain(here, args.ref)
    else:
        failed = _bootstrap_plain(here, args.ref)
    # Before the re-exec replaces this process: surface any improvements file the
    # upgrade step exported (its own notice scrolled by inside the progress screen).
    _flush_export_notes()
    if not args.no_setup:
        # Re-exec the freshly-updated harness so setup uses the new code (this running
        # process still holds the pre-update modules in memory).
        _reexec([sys.executable, str(Path(__file__).resolve()), "setup"])
    # Scripted `bootstrap --no-setup` must not exit 0 over a failed update.
    return 1 if failed else 0
    return 0
