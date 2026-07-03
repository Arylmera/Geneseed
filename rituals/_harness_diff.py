"""Geneseed harness — Drift report between a deployed install and a fresh render (back-port aid).

Part of the harness CLI (see harness.py). Imports the shared toolset from
_harness_core; cross-submodule names are linked at import time by harness.py,
so this file is only ever used through `import harness`."""
from __future__ import annotations

from _harness_core import *  # noqa: F401,F403  shared stdlib + primitives



def _cmp_key(rel: str, text: str) -> str:
    """How an owned file is keyed for drift. `.geneseed-version` carries a build-date
    stamp that is not a local edit, so key it on the fingerprint token alone."""
    if rel == build.VERSION_MARKER:
        toks = text.split()
        return toks[0] if toks else text
    return text


def _owned_set(d: Path) -> set:
    """The files a global Geneseed install owns, per its .geneseed-manifest.json."""
    try:
        data = json.loads((d / build.GLOBAL_MANIFEST).read_text(encoding="utf-8"))
        return set(data.get("owned", []))
    except (json.JSONDecodeError, OSError):
        return set()


def _diff_collect(target=None, theme=None, emit=None):
    """Compute the deployed-vs-source diff. Returns (target, theme, files) where files
    is a sorted list of {rel, status (edited|added|missing), diff (unified lines)} —
    or None when there is no deployed global install at target. `emit` overrides the
    marker read: for a claude/bob PROJECT install the marker sits at the repo root
    while `target` is the data dir (<repo>/.claude), so the caller that knows the
    resolved emit must pass it or the expected render falls back to OpenCode."""
    target = Path(target).expanduser() if target else build._opencode_config_dir()
    if not (target / build.GLOBAL_MANIFEST).exists():
        return target, theme, None
    if not theme:
        # Render the 'expected' copy in the theme the deployment ACTUALLY uses, so
        # themed wording is not reported as a difference — only genuine local edits
        # surface. Fall back to the configured/neutral theme only if undetectable.
        theme = _theme_of_dir(target)
    if not theme:
        cfgp = ROOT / "harness.config.json"
        theme = (json.loads(cfgp.read_text(encoding="utf-8")).get("theme", "neutral")
                 if cfgp.exists() else "neutral")
    # Render the 'expected' copy with the deployed install's OWN host emit (read from its
    # `.geneseed-emit` marker), so a Claude/Bob install isn't diffed against an
    # OpenCode-dialect tree — which would flag every agent + AGENT.md/opencode.json as
    # drift. Fall back to OpenCode for an unknown/missing marker.
    if not emit:
        try:
            emit = (target / ".geneseed-emit").read_text(encoding="utf-8").strip()
        except OSError:
            emit = ""
    host = _EMIT_HOST_SCOPE.get(emit, ("opencode", "global"))[0]
    emitter = build.HOSTS.get(host, build.HOSTS["opencode"])["emit_global"]
    files = []
    with tempfile.TemporaryDirectory() as tmp:
        expected = Path(tmp) / "expected"
        with contextlib.redirect_stdout(io.StringIO()):   # swallow the emit's own log
            emitter(theme, out=Path(tmp) / "bundle", cfg=expected)
        for rel in sorted(_owned_set(target) | _owned_set(expected)):
            a, b = target / rel, expected / rel
            if a.is_file() and b.is_file():
                ta = a.read_text(encoding="utf-8", errors="replace")
                tb = b.read_text(encoding="utf-8", errors="replace")
                if _cmp_key(rel, ta) != _cmp_key(rel, tb):
                    diff = list(difflib.unified_diff(
                        tb.splitlines(), ta.splitlines(),
                        fromfile=f"source/{rel}", tofile=f"deployed/{rel}", lineterm=""))
                    files.append({"rel": rel, "status": "edited", "diff": diff})
            elif a.is_file():
                body = a.read_text(encoding="utf-8", errors="replace").splitlines()
                files.append({"rel": rel, "status": "added",
                              "diff": ["(only in deployed — your addition)", ""]
                              + ["+" + ln for ln in body]})
            else:
                files.append({"rel": rel, "status": "missing",
                              "diff": ["(in source, not deployed — re-emit to add)"]})
    files.sort(key=lambda f: f["rel"])
    return target, theme, files


def _improvements_md(target, theme, files, when: str) -> str:
    """Render the deployed-vs-source drift as a self-contained markdown report — the
    artifact a user hands to an agent in this source repo to back-port the deployed
    harness's self-improvements into src/. Pure (unit-tested); `when` is the caller's
    timestamp so the render itself is reproducible."""
    edited = [f for f in files if f["status"] == "edited"]
    added = [f for f in files if f["status"] == "added"]
    missing = [f for f in files if f["status"] == "missing"]
    lines = [
        "# Geneseed — deployed improvements to back-port",
        "",
        f"- captured: {when}",
        f"- deployed: `{target}`",
        f"- theme: {theme}",
        f"- {len(edited)} edited · {len(added)} added in deployed · {len(missing)} missing from deployed",
        "",
        "The deployed harness drifted from a fresh render of `src/` — typically the",
        "self-improvement loops editing agent/skill files in place. Hand this file to",
        "an agent in the Geneseed source repo and ask it to fold the changes below",
        "back into `src/`. Diffs read source -> deployed; the expected copy was",
        "rendered in the deployed theme, so only genuine local edits appear.",
        "",
    ]
    label = {"edited": "edited in deployed",
             "added": "only in deployed — your addition",
             "missing": "in source, not deployed"}
    for f in files:
        lines += [f"## `{f['rel']}`  ({label[f['status']]})", "", "```diff",
                  *f["diff"], "```", ""]
    return "\n".join(lines) + "\n"


def _write_improvements(target, theme, files, out_path=None) -> Path:
    """Write the drift report for an already-collected diff. Default destination is
    a timestamped file under improvements/ INSIDE the deployed harness dir — the
    report lives beside the install it describes (e.g. ~/.config/opencode for the
    global emit). Never in the manifest: rebuilds compare only owned files so it is
    not reported as drift, re-emits do not clobber it, and uninstall leaves it in
    place (same contract as memory)."""
    now = datetime.datetime.now()
    path = (Path(out_path).expanduser() if out_path else
            Path(target) / "improvements" / now.strftime("improvements-%Y%m%d-%H%M%S.md"))
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(_improvements_md(target, theme, files,
                                     now.strftime("%Y-%m-%d %H:%M:%S")),
                    encoding="utf-8")
    return path


def export_improvements(target=None, theme=None, out_path=None):
    """Collect the deployed-vs-source drift and, when there IS any, write it as a
    markdown improvements file. Returns (path, files): path is None when nothing was
    written — no deployed install (files is None) or no drift (files is [])."""
    target, theme, files = _diff_collect(target, theme)
    if not files:
        return None, files
    return _write_improvements(target, theme, files, out_path), files


def _flush_export_notes() -> None:
    """Re-print, on the RESTORED terminal, the path of any improvements file exported
    since this process started — the in-TUI notices live on the alternate screen and
    vanish with it (or hide below a theme banner). Called after each curses session
    ends and before a re-exec replaces this process. Scans the global install's
    improvements/ dir rather than tracking calls, so exports made by subprocess steps
    (the upgrade inside bootstrap / update) are caught too."""
    try:
        d = build._opencode_config_dir() / "improvements"
        fresh = sorted(p for p in d.glob("improvements-*.md")
                       if p.stat().st_mtime >= _T0 - 1)
    except OSError:
        return
    if not fresh:
        return
    for p in fresh:
        print(f"[geneseed] improvements file saved: {p}")
    print("[geneseed] the deployed harness carried local edits — hand the file to "
          "your agent to back-port them into src/.")


def cmd_diff(args: argparse.Namespace) -> int:
    """Report how a DEPLOYED (ported) global harness differs from a fresh render of
    the current source — so edits made in place can be reviewed and back-ported to
    src/. `--full` shows the unified diffs. (The browse panel / main menu show this
    interactively, file-by-file.)"""
    target, theme, files = _diff_collect(args.target, args.theme)
    if files is None:
        sys.stderr.write(
            f"[diff] no global Geneseed install at {target} (no {build.GLOBAL_MANIFEST}). "
            f"Pass --target, or run `--emit opencode-global` first.\n")
        return 1
    edited = [f for f in files if f["status"] == "edited"]
    added = [f for f in files if f["status"] == "added"]
    missing = [f for f in files if f["status"] == "missing"]
    print(f"[diff] deployed {target}  vs  source (theme: {theme})")
    print(f"[diff] {len(edited)} edited, {len(added)} added-in-deployed, "
          f"{len(missing)} missing-from-deployed")
    for f in edited:
        print(f"  ~ {f['rel']}   (edited in deployed — review to back-port)")
    for f in added:
        print(f"  + {f['rel']}   (only in deployed — your addition)")
    for f in missing:
        print(f"  - {f['rel']}   (in source, not deployed — re-emit to add)")
    if args.out:
        if files:
            # bare `--out` parses as True (nargs="?" const) → default timestamped path
            out_path = None if args.out is True else args.out
            path = _write_improvements(target, theme, files, out_path)
            print(f"[diff] improvements file written: {path}")
        else:
            print("[diff] no differences — nothing written.")
    if args.full:
        for f in edited:
            print(f"\n--- {f['rel']} (source -> deployed) ---")
            print("\n".join(f["diff"]))
    elif edited and not args.out:
        print("\nRun with --full to see the line-level diffs, or --out FILE to export them.")
    return 0
