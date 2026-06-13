"""Geneseed harness — MCP-server presets/state and the manifest-tracked uninstall.

Part of the harness CLI (see harness.py). Imports the shared toolset from
_harness_core; cross-submodule names are linked at import time by harness.py,
so this file is only ever used through `import harness`."""
from __future__ import annotations

from _harness_core import *  # noqa: F401,F403  shared stdlib + primitives



def _unmerge_opencode_json(path: Path, entry: str) -> bool:
    """Remove `entry` from the OpenCode config's `instructions`, leaving every other
    key intact. Resolves a sibling `opencode.jsonc` first (the file OpenCode treats as
    authoritative) and reads it comment-tolerantly. Returns True if the file was
    changed. A commented `.jsonc` is NOT rewritten — that would drop the comments — so
    the user is told to remove the entry by hand and this returns False (unchanged)."""
    target = build._opencode_target(path)
    if not target.exists():
        return False
    try:
        cfg, had_comments = build._read_jsonc(target.read_text(encoding="utf-8"))
    except OSError:
        return False
    if not isinstance(cfg, dict):
        return False
    instr = cfg.get("instructions")
    if not isinstance(instr, list) or entry not in instr:
        return False
    if target.suffix == ".jsonc" and had_comments:
        print(f"[uninstall] {target.name} has comments — not rewriting it. Remove this "
              f"from its \"instructions\" by hand: {json.dumps(entry)}")
        return False
    cfg["instructions"] = [i for i in instr if i != entry]
    target.write_text(json.dumps(cfg, indent=2) + "\n", encoding="utf-8")
    return True


# ---- MCP servers (OpenCode) -------------------------------------------------
# Known, ready-to-wire MCP server presets the TUI can toggle into an opencode.json.
# Each `block` is written verbatim under the config's `mcp` key. Registering a server
# only points OpenCode at a command — the user still installs the tool itself (the
# harness never installs a converter silently; see SETUP.md → "MarkItDown via MCP").
_MCP_PRESETS = {
    "markitdown": {
        "label": "MarkItDown",
        "desc": "PDF / Office / HTML -> Markdown for the ingest skill. Install it with "
                "`pipx install markitdown-mcp` (or switch the command to "
                "[\"uvx\", \"markitdown-mcp\"]). Exposes one tool: convert_to_markdown(uri).",
        "block": {"type": "local", "command": ["markitdown-mcp"], "enabled": True},
    },
    "gitlab": {
        "label": "GitLab",
        "desc": "GitLab repo / MR / issue / CI tools via @zereight/mcp-gitlab (npx, no "
                "install). Edit GITLAB_PERSONAL_ACCESS_TOKEN (scopes: api, read_repository) "
                "and GITLAB_API_URL before use. Add a second entry (gitlab-2) for another "
                "instance.",
        "block": {"type": "local",
                  "command": ["npx", "-y", "@zereight/mcp-gitlab"],
                  "environment": {"GITLAB_PERSONAL_ACCESS_TOKEN": "",
                                  "GITLAB_API_URL": "https://gitlab.com/api/v4"},
                  "enabled": True},
    },
    "gitlab-2": {
        "label": "GitLab (2nd instance)",
        "desc": "A second GitLab instance (e.g. a self-hosted server) via the same "
                "@zereight/mcp-gitlab command. Point GITLAB_API_URL at the other instance "
                "and give it that instance's own token.",
        "block": {"type": "local",
                  "command": ["npx", "-y", "@zereight/mcp-gitlab"],
                  "environment": {"GITLAB_PERSONAL_ACCESS_TOKEN": "",
                                  "GITLAB_API_URL": "https://gitlab.example.com/api/v4"},
                  "enabled": True},
    },
    "filesystem": {
        "label": "Filesystem",
        "desc": "Read/write files under explicitly allowed directories via "
                "@modelcontextprotocol/server-filesystem (npx, no install). Replace the "
                "trailing path arg(s) with only the dir(s) the agent may touch "
                "(least-privilege).",
        "block": {"type": "local",
                  "command": ["npx", "-y", "@modelcontextprotocol/server-filesystem",
                              "/path/to/allowed/dir"],
                  "enabled": True},
    },
}


def _mcp_apply(config: dict, name: str, block: "dict | None") -> dict:
    """Pure: return a copy of `config` with MCP server `name` set to `block`, or
    removed when `block` is None. Never touches another key; drops an emptied `mcp`
    map; keeps `$schema` so a freshly created file is valid."""
    cfg = dict(config)
    cfg.setdefault("$schema", "https://opencode.ai/config.json")
    servers = dict(cfg.get("mcp") or {})
    if block is None:
        servers.pop(name, None)
    else:
        servers[name] = block
    if servers:
        cfg["mcp"] = servers
    else:
        cfg.pop("mcp", None)
    return cfg


def _mcp_state(config: dict, name: str) -> str:
    """'enabled' | 'disabled' | 'absent' for server `name`. A server with no explicit
    `enabled` key counts as enabled (OpenCode's default)."""
    server = (config.get("mcp") or {}).get(name)
    if not isinstance(server, dict):
        return "absent"
    return "enabled" if server.get("enabled", True) else "disabled"


def _mcp_set_enabled(config: dict, name: str, enabled: bool) -> dict:
    """Pure: flip a present server's `enabled` flag. No-op when the server is absent."""
    server = (config.get("mcp") or {}).get(name)
    if not isinstance(server, dict):
        return config
    block = dict(server)
    block["enabled"] = enabled
    return _mcp_apply(config, name, block)


def _mcp_load(path: Path) -> dict:
    """Read an OpenCode config into a dict; {} if missing or malformed. Comment-tolerant
    so a hand-maintained `opencode.jsonc` parses (its `//` and `/* */` are stripped)."""
    if not path.exists():
        return {}
    try:
        data, _ = build._read_jsonc(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except OSError:
        return {}


def _mcp_commented(path: Path) -> bool:
    """True when `path` is an existing `.jsonc` that carries comments — the case where
    a non-destructive rewrite would drop the user's comments, so the MCP screen must
    refuse to save and warn instead."""
    if path.suffix != ".jsonc" or not path.exists():
        return False
    try:
        _, had = build._read_jsonc(path.read_text(encoding="utf-8"))
        return had
    except OSError:
        return False


def _mcp_save(path: Path, config: dict) -> None:
    """Write `config` back as pretty JSON (the same shape build.py emits)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")


def _mcp_targets() -> "list[tuple[str, Path]]":
    """Candidate OpenCode config files to manage, most-local first: the current
    project's, then OpenCode's global config dir. Each resolves to a present sibling
    `opencode.jsonc` (the file OpenCode treats as authoritative) when one exists, else
    `opencode.json`. Both targets are offered whether or not they exist yet — choosing
    one creates the `.json` on first write."""
    targets = [("this project", build._opencode_target(Path.cwd() / "opencode.json"))]
    try:
        targets.append(("global config",
                        build._opencode_target(build._opencode_config_dir() / "opencode.json")))
    except Exception:
        pass
    return targets


def _mcp_default_target(targets: "list[tuple[str, Path]]") -> int:
    """Pick which target the screen opens on. The strongest signal is which config
    file already exists — that's the one OpenCode actually reads — so if exactly one
    is present, land there (this is what stops edits going to a stray `<cwd>/
    opencode.json` while the user watches the global file). If none or both exist,
    follow the detected install mode: a global install opens on the global config,
    otherwise the project."""
    existing = [i for i, (_l, p) in enumerate(targets) if p.exists()]
    if len(existing) == 1:
        return existing[0]
    prefer = "global config" if (_installed_defaults().get("emit") or "") == \
        "opencode-global" else "this project"
    return next((i for i, (label, _p) in enumerate(targets) if label == prefer), 0)


def _mcp_known_names(config: dict) -> list:
    """Server names to show in the MCP screen: the built-in presets first, then any
    server already present in THIS config that isn't a preset — so user-added servers
    (gitlab, filesystem, …) are visible and manageable, not just the presets. Pure."""
    names = list(_MCP_PRESETS)
    present = list((config.get("mcp") or {}).keys()) if isinstance(config, dict) else []
    names += [n for n in present if n not in _MCP_PRESETS]
    return names


def _mcp_meta(name: str) -> "tuple[str, str]":
    """(label, description) for a server row: the preset's metadata when known, else the
    bare server name and a generic note (a server discovered in the config, not a
    Geneseed preset — still toggleable/removable). Pure."""
    p = _MCP_PRESETS.get(name)
    if p:
        return p["label"], p["desc"]
    return name, ("User-defined MCP server (not a Geneseed preset). It lives in this "
                  "config already — 'e' enables/disables it, Enter removes it.")


def _archive_memory(memory_dir: Path) -> Path:
    """Move a memory store into a timestamped snapshot under a sibling
    `archived-memory/` (created if absent). Memory is NEVER deleted — only set aside,
    so learned facts survive an uninstall and can be restored by copying back.
    Returns the archive path."""
    stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    dest = memory_dir.parent / "archived-memory" / stamp
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.move(str(memory_dir), str(dest))
    return dest


def _uninstall_global(target: Path, archive_memory: bool) -> dict:
    """Reverse a global install at `target` using its manifest: remove owned files,
    prune emptied dirs, drop the AGENT.md entry from opencode.json, and delete the
    markers. The memory store is NEVER deleted — kept in place by default, or moved to
    a sibling `archived-memory/<timestamp>/` when archive_memory. Returns a summary
    dict (with `archived` = the archive path, or None)."""
    try:
        owned = json.loads((target / build.GLOBAL_MANIFEST).read_text(encoding="utf-8")).get("owned", [])
    except (json.JSONDecodeError, OSError):
        owned = []
    removed = 0
    failed = []
    for rel in owned:
        victim = target / rel
        try:
            if victim.is_file():
                victim.unlink()
                removed += 1
                if victim.name == "SKILL.md" and victim.parent != target \
                        and not any(victim.parent.iterdir()):
                    victim.parent.rmdir()
        except OSError as e:
            failed.append(f"{rel} ({e})")
    if failed:
        # A locked or permission-blocked file survives the uninstall while the
        # manifest below is deleted — name the leftovers so the user can finish
        # the job by hand instead of believing the dir is clean.
        sys.stderr.write("[uninstall] WARN: could not remove "
                         f"{len(failed)} owned file(s): {', '.join(failed)}\n")
    for d in ("agents", "skills", "plugins"):
        p = target / d
        try:
            if p.is_dir() and not any(p.iterdir()):
                p.rmdir()
        except OSError:
            pass
    unmerged = _unmerge_opencode_json(target / "opencode.json", (target / "AGENT.md").as_posix())
    for m in (build.GLOBAL_MANIFEST, ".geneseed-theme", ".geneseed-emit", build.VERSION_MARKER):
        try:
            (target / m).unlink()
        except OSError:
            pass
    archived = None
    if archive_memory and (target / "memory").is_dir():
        archived = _archive_memory(target / "memory")
    return {"removed": removed, "unmerged": unmerged, "archived": archived}


def cmd_uninstall(args: argparse.Namespace) -> int:
    """Remove a global Geneseed install (the manifest-tracked opencode-global one):
    its owned files, the opencode.json instructions entry, and the markers. The
    memory store is NEVER deleted — kept in place by default, or moved aside to a
    sibling `archived-memory/<timestamp>/` with --archive-memory. Per-repo `.opencode/`
    installs have no manifest — remove those manually (`rm -rf .opencode`, drop
    AGENT.md from opencode.json)."""
    target = Path(args.target).expanduser().resolve() if args.target else build._opencode_config_dir()
    if not (target / build.GLOBAL_MANIFEST).exists():
        sys.stderr.write(
            f"[uninstall] no global Geneseed install at {target} (no {build.GLOBAL_MANIFEST}).\n"
            f"[uninstall] per-repo installs: rm -rf .opencode and drop AGENT.md from "
            f"opencode.json's instructions.\n")
        return 1
    has_memory = (target / "memory").is_dir()
    print(f"[uninstall] target: {target}")
    print("[uninstall] removes: AGENT.md, agents/, skills/, plugins/, markers, and the "
          "opencode.json instructions entry.")
    if has_memory:
        print("[uninstall] memory: " + ("will be ARCHIVED to archived-memory/ (never deleted)"
                                         if args.archive_memory
                                         else "KEPT in place — pass --archive-memory to set it aside"))
    if not args.yes:
        if not sys.stdin.isatty():
            sys.stderr.write("[uninstall] refusing to proceed without --yes (non-interactive).\n")
            return 1
        if not _confirm("Proceed with uninstall?", False):
            print("[uninstall] cancelled — nothing removed.")
            return 0
    s = _uninstall_global(target, args.archive_memory)
    mem = f"archived -> {s['archived']}" if s["archived"] else "kept in place"
    print(f"[uninstall] done — removed {s['removed']} file(s); opencode.json "
          f"{'updated' if s['unmerged'] else 'unchanged'}; memory {mem}. "
          f"Start a new OpenCode session to apply.")
    return 0
