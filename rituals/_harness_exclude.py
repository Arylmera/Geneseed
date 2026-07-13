"""Geneseed harness — sovereign-repo exclusions for the GLOBAL installs.

`harness exclude add|remove|list` maintains <cfg>/excludes.json across every
detected global install and wires the native per-repo preamble suppression into
the excluded repo (Claude: claudeMdExcludes in .claude/settings.local.json; Bob:
the rules/geneseed.md shadow stub). The runtime consumer is sovereign_bypass()
in _harness_context.py; the OpenCode plugins carry a JS twin.

Part of the harness CLI (see harness.py). Imports the shared toolset from
_harness_core; cross-submodule names are linked at import time by harness.py."""
from __future__ import annotations

from _harness_core import *  # noqa: F401,F403  shared stdlib + primitives


def _global_installs() -> "list[tuple[str, Path]]":
    """Every host whose GLOBAL config dir carries a Geneseed manifest."""
    out = []
    for host, row in build.HOSTS.items():
        try:
            cfg = row["config_dir"]()
        except Exception:  # noqa: BLE001 — a broken resolver must not kill the CLI
            continue
        if (cfg / build.GLOBAL_MANIFEST).is_file():
            out.append((host, cfg))
    return out


def _read_excludes(cfg: Path) -> dict:
    try:
        data = json.loads((cfg / build.EXCLUDES_FILE).read_text(encoding="utf-8"))
        if isinstance(data, dict) and isinstance(data.get("excludes"), list):
            return data
    except (OSError, json.JSONDecodeError, ValueError):
        pass
    return json.loads(build.EXCLUDES_STUB)  # single source of truth w/ the seeded stub


def _write_excludes(cfg: Path, data: dict) -> None:
    """Atomic (temp + os.replace) — a torn excludes.json would degrade every hook
    to 'not excluded' until repaired; mirrors _write_manifest_atomic."""
    dest = cfg / build.EXCLUDES_FILE
    tmp = dest.with_suffix(dest.suffix + ".tmp")
    tmp.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    os.replace(tmp, dest)


def _canon(path: str) -> Path:
    return Path(path).expanduser().resolve()


def _same(stored, repo: Path) -> bool:
    if not isinstance(stored, str) or not stored:
        return False
    return os.path.normcase(str(Path(stored))) == os.path.normcase(str(repo))


def exclude_add(path: str) -> dict:
    """Add `path` to every global install's list + wire the per-repo suppression.
    Idempotent; returns {"ok", "path", "messages"}."""
    import _build_emit
    repo = _canon(path)
    messages: list[str] = []
    if not repo.is_dir():
        messages.append(f"warning: {repo} does not exist (excluded anyway)")
    installs = _global_installs()
    if not installs:
        return {"ok": False, "path": str(repo),
                "messages": ["no global Geneseed install found — nothing to exclude from"]}
    for host, cfg in installs:
        wired: dict = {}
        if host == "claude" and repo.is_dir():
            entry = (cfg / "CLAUDE.md").resolve().as_posix()
            added = _build_emit._wire_claude_excludes(
                repo / ".claude" / "settings.local.json", [entry])
            wired["claude_md_excludes"] = added or [entry]
            if not added:
                messages.append(f"{host}: claudeMdExcludes already present (kept)")
        if host == "bob" and repo.is_dir():
            stub = repo / ".bob" / "rules" / "geneseed.md"
            if stub.exists():
                # Ownership is decided by CONTENT, not mere existence — a re-add (idempotent
                # call) finds a stub that already exists because WE wrote it last time; an
                # existence-only check would misread that as "user content" and orphan it
                # on the next remove. Exact match means ours.
                try:
                    ours = stub.read_text(encoding="utf-8") == build._BOB_RULES_STUB
                except OSError:
                    ours = False
                wired["bob_rules_stub"] = ours
                if not ours:
                    messages.append(f"{host}: rules/geneseed.md already exists (kept, not ours)")
            else:
                stub.parent.mkdir(parents=True, exist_ok=True)
                stub.write_text(build._BOB_RULES_STUB, encoding="utf-8")
                wired["bob_rules_stub"] = True
        if host == "copilot":
            messages.append("copilot: no native suppression exists — the global "
                            "copilot-instructions.md still loads there (documented limitation)")
        data = _read_excludes(cfg)
        entries = [e for e in data["excludes"]
                   if not (isinstance(e, dict) and _same(e.get("path"), repo))]
        entries.append({"path": str(repo).replace(os.sep, "/"), "wired": wired})
        data["excludes"] = entries
        _write_excludes(cfg, data)
    return {"ok": True, "path": str(repo), "messages": messages}


def exclude_remove(path: str) -> dict:
    """Reverse exclude_add: unwire exactly what `wired` recorded, then drop the
    entry from every install's list. Hand-deleted wiring is reported, not fatal."""
    import _build_emit
    repo = _canon(path)
    messages: list[str] = []
    found = False
    for host, cfg in _global_installs():
        data = _read_excludes(cfg)
        keep, mine = [], None
        for e in data["excludes"]:
            if isinstance(e, dict) and _same(e.get("path"), repo):
                mine = e
            else:
                keep.append(e)
        if mine is None:
            continue
        found = True
        wired = mine.get("wired") or {}
        if wired.get("claude_md_excludes"):
            _build_emit._unwire_claude_excludes(
                repo / ".claude" / "settings.local.json", wired["claude_md_excludes"])
        if wired.get("bob_rules_stub"):
            stub = repo / ".bob" / "rules" / "geneseed.md"
            try:
                if stub.is_file():
                    stub.unlink()
                    if not any(stub.parent.iterdir()):
                        stub.parent.rmdir()
                else:
                    messages.append(f"{host}: shadow stub already gone")
            except OSError as e:
                messages.append(f"{host}: could not remove {stub} ({e})")
        data["excludes"] = keep
        _write_excludes(cfg, data)
    if not found:
        messages.append(f"{repo} was not excluded")
    return {"ok": found, "path": str(repo), "messages": messages}


def excludes_snapshot() -> dict:
    """Union view across installs — the CLI `list` and the web endpoint share it.
    Also flags installs whose lists diverge (e.g. a global emit created after the
    exclusions were added starts with an empty stub)."""
    installs = _global_installs()
    by_path: dict[str, dict] = {}
    for host, cfg in installs:
        for e in _read_excludes(cfg)["excludes"]:
            p = e.get("path") if isinstance(e, dict) else e
            if not isinstance(p, str) or not p:
                continue
            key = os.path.normcase(str(Path(p)))
            rec = by_path.setdefault(key, {"path": p, "hosts": [],
                                           "wired": (e.get("wired") if isinstance(e, dict) else None) or {}})
            rec["hosts"].append(host)
    return {"excludes": sorted(by_path.values(), key=lambda r: r["path"]),
            "installs": [{"host": h, "cfg": str(c)} for h, c in installs]}


def cmd_exclude(args: argparse.Namespace) -> int:
    if args.action == "list":
        snap = excludes_snapshot()
        if not snap["installs"]:
            print("[geneseed] no global install found.")
            return 1
        if not snap["excludes"]:
            print("[geneseed] no folders excluded.")
            return 0
        all_hosts = {i["host"] for i in snap["installs"]}
        for rec in snap["excludes"]:
            missing = sorted(all_hosts - set(rec["hosts"]))
            flag = f"  (MISSING from: {', '.join(missing)} — re-run `harness exclude add`)" if missing else ""
            print(f"  {rec['path']}  [{', '.join(sorted(rec['hosts']))}]{flag}")
        return 0
    if not args.path:
        print("[geneseed] exclude add/remove needs a folder path.", file=sys.stderr)
        return 2
    res = exclude_add(args.path) if args.action == "add" else exclude_remove(args.path)
    for m in res["messages"]:
        print(f"[geneseed] {m}", file=sys.stderr)
    verb = "excluded" if args.action == "add" else "re-included"
    print(f"[geneseed] {res['path']} {verb}." if res["ok"]
          else f"[geneseed] nothing done for {res['path']}.")
    return 0 if res["ok"] else 1
