"""Geneseed build — the host-config wiring layer: JSONC parsing, the settings.json /
opencode.json merges, the hook shim, and the managed-block machinery.

**This is the half of the emit that edits files the USER co-owns**, and the reason it is
its own module: every function here reconciles Geneseed's claim with content it did not
write, and nine of the ten entry points are called from the RUNTIME as well as from an
emit — `rituals/_harness_mcp.py` drives them for deactivate, remerge, reactivate and
uninstall, and `exclude`/`mcp` use them too. Rendering can move hosts; this cannot,
without either spawning an interpreter per `exclude add` or maintaining two
implementations of the code that edits somebody's real settings.json.

The dependency closure is deliberately empty in one direction: nothing here calls into
_build_render or _build_emit. Keep it that way — that closure is what makes this a unit
rather than a region of a larger file.

Part of the build CLI (see build.py). Imports the shared toolset from _build_core."""
from __future__ import annotations

import _build_core
from _build_core import *  # noqa: F401,F403  shared stdlib + constants


_OPENCODE_SCHEMA = "https://opencode.ai/config.json"


def _default_permission() -> dict:
    """A fresh copy of the minimal, non-destructive default permission policy — ASK
    before the few genuinely irreversible or outward-facing bash patterns (Laws
    I/IV/XX). `git commit*` and `git push*` gate EVERY commit and push, on any branch,
    so the agent never records or shares history unprompted (Law XX's host-level
    backstop); the `--force`/`-f` entries are kept as explicit, more-specific markers.
    Added ONLY when the user has no `permission` key at all; never overwrites an
    existing policy. Unmatched commands keep OpenCode's default (allow), so normal
    local work (edits, builds, tests) is unaffected."""
    return {
        "bash": {
            "rm -rf *": "ask",
            "git commit*": "ask",
            "git push*": "ask",
            "git push --force*": "ask",
            "git push -f*": "ask",
        }
    }


def _opencode_target(json_path: Path) -> Path:
    """The OpenCode config file to actually operate on at this location. OpenCode loads
    BOTH `opencode.json` and `opencode.jsonc` and merges them, with `.jsonc` winning on
    conflict, and writes to `.jsonc` first when it exists. So a present sibling `.jsonc`
    is the authoritative file — operate on it, not on a separate `.json` we'd be
    splitting config across. Given a `…/opencode.json` path, return its `…/opencode.jsonc`
    sibling when that exists, else the `.json` path (so we never create a `.jsonc`
    ourselves)."""
    jsonc = json_path.with_suffix(".jsonc")
    return jsonc if jsonc.exists() else json_path


def _read_jsonc(text: str) -> "tuple[object, bool]":
    """Parse JSON-with-comments, returning (data, had_comments). String-aware: `//`
    line and `/* */` block comments are stripped only OUTSIDE string literals, and
    trailing commas are removed, before `json.loads`. A `//` inside a string — notably
    the `$schema` value `https://opencode.ai/config.json` — is preserved and does NOT
    set `had_comments`. Only `"` delimits strings (JSON has no single-quoted strings),
    so an apostrophe inside a description never confuses the scan. Unparseable input
    yields ({}, had_comments), preserving the caller's malformed-file fallback."""
    out: "list[str]" = []
    had_comments = False
    i, n, in_str = 0, len(text), False
    while i < n:
        ch = text[i]
        if in_str:
            out.append(ch)
            if ch == "\\" and i + 1 < n:
                out.append(text[i + 1])
                i += 2
                continue
            if ch == '"':
                in_str = False
            i += 1
            continue
        if ch == '"':
            in_str = True
            out.append(ch)
            i += 1
            continue
        if ch == "/" and i + 1 < n and text[i + 1] == "/":
            had_comments = True
            i += 2
            while i < n and text[i] not in ("\n", "\r"):
                i += 1
            continue
        if ch == "/" and i + 1 < n and text[i + 1] == "*":
            had_comments = True
            i += 2
            while i + 1 < n and not (text[i] == "*" and text[i + 1] == "/"):
                i += 1
            i += 2
            continue
        if ch in "}]":
            # Structural close, outside any string: drop a trailing comma before it
            # (with intervening whitespace). String-aware by construction — a comma
            # inside a string is followed by that string's closing quote, never by a
            # bare structural brace, so it is never the char we pop here.
            while out and out[-1] in " \t\r\n":
                out.pop()
            if out and out[-1] == ",":
                out.pop()
            out.append(ch)
            i += 1
            continue
        out.append(ch)
        i += 1
    stripped = "".join(out)
    try:
        return json.loads(stripped), had_comments
    except (json.JSONDecodeError, ValueError):
        # None = UNPARSEABLE, distinct from a legitimately empty {} — writers
        # must refuse to rewrite such a file (it would destroy the user's
        # config over a single typo); readers treat it like "no data".
        return None, had_comments


def _warn_commented_jsonc(target: Path, agent_path: str, include_permission: bool,
                          include_lsp: bool = False, prefix: str = "geneseed") -> None:
    """Tell the user how to wire Geneseed in by hand. Called only when `target` is a
    `.jsonc` carrying comments and we have a real change to make — we refuse to rewrite
    such a file (it would drop the comments), so we print the exact entry instead."""
    print(f"[{prefix}] {target.name} has comments — not rewriting it (your edits are "
          f"kept). Add this to its \"instructions\" array by hand:")
    print(f"[{prefix}]     {json.dumps(agent_path)}")
    if include_permission:
        print(f"[{prefix}] and, for Geneseed's default ask-gates, a \"permission\" key:")
        for line in json.dumps(_default_permission(), indent=2).splitlines():
            print(f"[{prefix}]     {line}")
    if include_lsp:
        print(f"[{prefix}] and, to enable code intelligence, a top-level \"lsp\": true")


def _atomic_write_json(path: Path, config: dict) -> None:
    """Write a user-owned JSON config via sibling temp file + os.replace, so a
    crash mid-write can never leave the file half-written (same pattern as the
    manifest write in _build_global.py). Raises OSError on failure — callers
    already catch and warn without crashing the emit."""
    tmp = path.with_name(path.name + ".geneseed-tmp")
    tmp.write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")
    try:
        os.replace(tmp, path)
    except OSError:
        tmp.unlink(missing_ok=True)
        raise


def _merge_opencode_json(path: Path, agent_path: str) -> Path:
    """Ensure the OpenCode config at `path`'s location has `agent_path` in its
    `instructions` array, preserving every other key the user may have set. Resolves a
    sibling `opencode.jsonc` first (see `_opencode_target`) and reads it comment-tolerantly.
    Never clobbers a hand-edited config — it merges the one entry (plus a default
    `permission` policy only when absent). An already-satisfied config is left
    completely untouched. A commented `.jsonc` that still needs a change is NOT
    rewritten (that would strip the comments); the user is warned with the exact entry
    to add. A malformed config is likewise never rewritten — one typo must not cost the
    user their whole file. Best-effort but LOUD: a read failure (permissions, a locked
    file) aborts the merge with a `[geneseed] WARN` naming the path and the reason —
    never silently falls through to treat an unreadable file as empty, which would
    otherwise overwrite it with a fresh default config and lose the user's actual
    settings. A write failure is caught the same way — printed, never left to crash the
    whole emit (other targets/hosts in the same run may still complete). Returns the
    resolved target path (the file we wrote, warned about, or found already wired)."""
    target = _opencode_target(path)
    config: dict = {"$schema": _OPENCODE_SCHEMA, "instructions": []}
    had_comments = False
    if target.exists():
        try:
            raw = target.read_text(encoding="utf-8")
        except OSError as e:
            print(f"[geneseed] WARN: could not read {target} ({e}) — NOT touching it. "
                  f'Add {json.dumps(agent_path)} to its "instructions" array by hand '
                  f"once it's readable again.", file=sys.stderr)
            return target
        loaded, had_comments = _read_jsonc(raw)
        # non-dict covers valid-but-wrong JSON (an array, a string): overwriting
        # it with the default config would silently destroy the user's file.
        if loaded is None or not isinstance(loaded, dict):
            print(f"[geneseed] {target.name} is not a JSON object — NOT rewriting it "
                  f"(fix the file, then re-run). Add {json.dumps(agent_path)} to "
                  f'its "instructions" once repaired.', file=sys.stderr)
            return target
        config = loaded
    config.setdefault("$schema", _OPENCODE_SCHEMA)
    instr = config.get("instructions")
    if not isinstance(instr, list):
        instr = []
    add_instr = agent_path not in instr
    if add_instr:
        instr.append(agent_path)
    config["instructions"] = instr
    add_perm = "permission" not in config
    if add_perm:
        config["permission"] = _default_permission()
    add_lsp = "lsp" not in config
    if add_lsp:
        config["lsp"] = True   # enable every built-in server (LSP is off by default)
    if not (add_instr or add_perm or add_lsp):
        return target   # already wired — leave the file (and any comments) untouched
    if target.suffix == ".jsonc" and had_comments:
        _warn_commented_jsonc(target, agent_path, add_perm, add_lsp)
        return target
    try:
        _atomic_write_json(target, config)
    except OSError as e:
        print(f"[geneseed] WARN: could not write {target} ({e}) — the harness will NOT "
              f'auto-load until this is fixed. Add {json.dumps(agent_path)} to its '
              f'"instructions" array by hand.', file=sys.stderr)
    return target


# ---- Claude Code wiring: settings.json hooks + the CLAUDE.md managed block --------
# Claude has no `instructions` array (it auto-loads CLAUDE.md by location) and no JS
# plugins (~/.claude/plugins/ is a managed marketplace, never written). The harness
# reaches Claude through settings.json HOOKS instead — context injection, learn, and
# the git-gate, the same three `harness.py` subcommands the OpenCode plugins drive.

# The adapter's adapters/claude-code/settings.json is the reference for a MANUAL /
# vendored-in-repo install (project-relative, assumes rituals/ at the repo root). A
# GENERATED install (global or an arbitrary folder) can't assume that, so the hooks are
# built programmatically here with ABSOLUTE paths: the interpreter + absolute harness.py
# (known at emit time), and `learn --memory <install>/memory` so memory lands in the
# install's store, not the project cwd. The `cat AGENT.md` startup hooks are dropped —
# CLAUDE.md auto-loads by location, so re-injecting it would double up and would error in
# any repo without an AGENT.md. Hooks run with the project cwd, which is exactly what
# `context` wants (it auto-discovers the project's docs).
# ---- the hook shim ---------------------------------------------------------------
# Emitted hook commands used to embed TWO machine-absolute paths: the interpreter
# (sys.executable) and the checkout (ROOT/rituals/harness.py). That made every deployed
# config depend on where this clone happens to sit, so moving or replacing the checkout
# silently broke the gates in every install at once.
#
# The shim breaks that coupling with one level of indirection: emitted configs name only
# `~/.geneseed/bin/hook`, a stable path that never changes, and the shim body carries the
# two volatile paths. Re-pointing every install at a new checkout becomes one file write
# instead of a re-emit of every config.
#
# Three constraints the body must respect, each learned from a real failure mode:
#   1. STDOUT IS THE DECISION CHANNEL. git-gate and rule-gate return 0 on every path and
#      signal via a JSON object on stdout (see _harness_context.cmd_git_gate); `context`
#      injects its payload the same way. A single stray byte — a cmd.exe command echo, a
#      "created ~/.geneseed" notice — corrupts that JSON and the gate silently stops
#      gating while still reporting success. Hence `@echo off`, and a shim that prints
#      nothing, ever.
#   2. NO INTERPRETER PROBING. The launchers hunt for python because a user runs them by
#      hand; the shim must not. Bare `python` on a locked-down Windows box resolves to
#      the Microsoft Store alias stub (see geneseed.cmd), and a probe would also add
#      process spawns to a hook that fires on EVERY Bash/Write tool call. sys.executable
#      is baked in instead.
#   3. ONE PROCESS WHERE POSSIBLE. POSIX `exec` replaces the shell, so the shim costs
#      nothing. cmd.exe has no exec, so the .cmd form is permanently +1 process per hook
#      — the reason the body stays this small.
#   4. THE MARKER LIVES IN THE FILENAME. `_GENESEED_HOOK_SNIFF` has to recognise a
#      Geneseed hook by substring, and the containing directory is relocatable
#      (GENESEED_HOME), so keying the marker off `.geneseed/` would make a relocated
#      install's hooks unrecognisable to the orphan scan. `geneseed-hook` travels with
#      the file wherever the dir goes, and is specific enough that a user's own hook
#      will never collide with it.
_SHIM_MARK = "geneseed-hook"
_SHIM_REL = ("bin", _SHIM_MARK + (".cmd" if sys.platform == "win32" else ""))


def _shim_home() -> Path:
    """User-global Geneseed dir. GENESEED_HOME relocates it (mirrors the GENESEED_HARNESS
    / BOB_CONFIG_DIR knobs), which is also how the test sandbox keeps emits hermetic."""
    env = os.environ.get("GENESEED_HOME")
    return Path(env).expanduser() if env else Path.home() / ".geneseed"


def _hook_shim_path() -> Path:
    return _shim_home().joinpath(*_SHIM_REL)


def _hook_shim_body() -> str:
    """The shim's contents: forward argv verbatim to harness.py, print nothing, and
    propagate the child's exit code. `%*` / `"$@"` keep the emitted `--root "<cfg>"`
    quoting intact, so no re-quoting happens at either layer."""
    py, h = sys.executable, _build_core.ROOT / "rituals" / "harness.py"
    if sys.platform == "win32":
        # Bare `exit /b` propagates the LIVE errorlevel; `%ERRORLEVEL%` would expand at
        # parse time and return a stale one. Never plain `exit` — that kills the parent
        # cmd.exe, so the emitted `|| exit 0` would never get to evaluate. (Same idioms
        # as geneseed.cmd, deliberately copied rather than reinvented.)
        return (
            "@echo off\r\n"
            "rem Generated by Geneseed - do not edit. Rewritten on every emit.\r\n"
            "setlocal\r\n"
            f'"{py}" "{h}" %*\r\n'
            "exit /b\r\n"
        )
    return (
        "#!/bin/sh\n"
        "# Generated by Geneseed - do not edit. Rewritten on every emit.\n"
        f'exec "{py}" "{h}" "$@"\n'
    )


def _write_hook_shim() -> "Path | None":
    """Create or refresh the shim; return its path, or None when it could not be written.

    Rewritten on EVERY emit, which is what replaces the self-heal the old form gave for
    free: when the emitted command itself carried the checkout path, a moved checkout
    made the command non-canonical and _merge_claude_settings re-wired it. Now the config
    is invariant under a move and the stale path hides in the shim body instead — so the
    body has to be refreshed by the same routine that emits, and `doctor` gained a gate
    that reads it back (_harness_build._shim_problems).

    Unchanged content is never rewritten: on Windows a shim that a hook is executing
    right now cannot be replaced, and a rebuild firing mid-session would otherwise raise
    a sharing violation into the build. The temp name carries the pid rather than being a
    fixed sibling, so concurrent emits (the web console's Build job alongside a manual
    rebuild-all) cannot unlink each other's file."""
    p, body = _hook_shim_path(), _hook_shim_body()
    try:
        # Compare newline-normalised: the body is written with explicit CRLF on Windows,
        # but read_text() translates back to \n, so a raw == would never match and the
        # "unchanged" fast path — the whole point of this branch — would never be taken.
        if (p.is_file()
                and p.read_text(encoding="utf-8").replace("\r\n", "\n")
                == body.replace("\r\n", "\n")):
            return p
        p.parent.mkdir(parents=True, exist_ok=True)
        tmp = p.with_name(f"{p.name}.{os.getpid()}.tmp")
        tmp.write_text(body, encoding="utf-8", newline="")
        if sys.platform != "win32":
            os.chmod(tmp, 0o755)
        os.replace(tmp, p)
        return p
    except OSError:
        return None


def _hook_prefix() -> str:
    """The `<runner> <entrypoint>` prefix every emitted hook command starts with.

    Falls back to the pre-shim direct form when the shim cannot be written (a read-only
    or absent home). That is strictly no worse than the old behaviour, and far better
    than emitting commands that name a shim which does not exist — those would fail on
    every hook (9009 under cmd.exe, 127 under sh) and take both gates down with them."""
    shim = _write_hook_shim()
    if shim is not None:
        return f'"{shim}"'
    print(f"[geneseed] WARN: could not write the hook shim at {_hook_shim_path()} — "
          "emitting hooks that call the interpreter directly. They will break if this "
          "checkout moves; re-run the build to repair them.", file=sys.stderr)
    return f'"{sys.executable}" "{_build_core.ROOT / "rituals" / "harness.py"}"'


def _claude_hook_groups(cfg: Path) -> dict:
    """Geneseed's Claude hooks for an install rooted at `cfg`, keyed by event."""
    run = _hook_prefix()
    mem = f'--memory "{cfg / "memory"}"'
    # --root carries the install's own dir so a GLOBAL hook can stand down when a project
    # install of the same host sits at/above cwd (project-bypasses-global; see cmd_context).
    context = f'{run} context --root "{cfg}" || exit 0'
    # --root enables the sovereign-repo bypass (excludes.json) — same reason context
    # carries it. git-gate has no other install-dir dependency.
    gate = f'{run} git-gate --root "{cfg}"'
    rule_gate = f'{run} rule-gate --root "{cfg}"'
    return {
        "PreToolUse": [
            {"matcher": "Bash", "hooks": [{"type": "command", "command": gate}]},
            {"matcher": "Write|Edit|MultiEdit|NotebookEdit",
             "hooks": [{"type": "command", "command": rule_gate}]},
        ],
        "SessionStart": [
            {"matcher": "startup|clear", "hooks": [{"type": "command", "command": context}]},
            {"matcher": "resume", "hooks": [{"type": "command", "command": context}]},
        ],
        "Stop": [
            # `|| exit 0` (not `|| true`): hooks run under cmd.exe on native Windows,
            # where `true` is not a command — the swallow-failures intent would invert
            # into a 9009 error. `exit 0` works in both cmd.exe and POSIX sh.
            {"hooks": [{"type": "command", "command": f"{run} learn {mem} || exit 0"}]},
        ],
        "SubagentStop": [
            # Same command as Stop: `learn` reads the payload's hook_event_name and
            # routes a SubagentStop to the per-agent lesson path (memory/agents/<name>.md).
            {"hooks": [{"type": "command", "command": f"{run} learn {mem} || exit 0"}]},
        ],
    }


def _merge_claude_settings(path: Path, scope: str = "global",
                           prior_hooks: "list | None" = None) -> "tuple[Path, list]":
    """Surgically merge Geneseed's Claude hooks into the user's settings.json,
    preserving every other key AND the user's own hook entries. The install root is
    `path.parent` (so `learn` is pointed at <root>/memory). `prior_hooks` is the
    manifest's previously-recorded managed groups: any of them still in the file but
    no longer canonical (an old interpreter/checkout path after a move, or the
    pre-`|| exit 0` hook form) is PRUNED — without this a re-emit stacks the new
    group beside the stale one, so `learn` runs twice per Stop and a dead python
    path errors on every call. Returns (target, managed) where `managed` is the
    complete current claim set (surviving prior groups + newly added), recorded in
    the manifest so unwire/uninstall removes EXACTLY those and nothing else.
    Idempotent (a group already present is not re-added; a user's own identical
    group is never claimed). A settings.json carrying comments is never rewritten —
    the user is warned and the prior claims are kept unchanged."""
    prior = [r for r in (prior_hooks or []) if isinstance(r, dict)]
    config: dict = {}
    had_comments = False
    if path.exists():
        try:
            loaded, had_comments = _read_jsonc(path.read_text(encoding="utf-8"))
            if loaded is None:
                print(f"[geneseed] {path.name} is not valid JSON — NOT rewriting it "
                      f"(fix the syntax, then re-run). Hooks were not wired.",
                      file=sys.stderr)
                return path, prior
            if isinstance(loaded, dict):
                config = loaded
        except OSError:
            pass
    hooks = config.get("hooks")
    if not isinstance(hooks, dict):
        hooks = {}
    canonical = _claude_hook_groups(path.parent)
    canon_flat = [{"event": e, "group": g} for e, gs in canonical.items() for g in gs]
    pruned = False
    for rec in prior:
        if rec in canon_flat:
            continue
        event, group = rec.get("event"), rec.get("group")
        arr = hooks.get(event)
        if isinstance(arr, list) and group in arr:
            arr.remove(group)
            pruned = True
            if not arr:
                hooks.pop(event, None)
    added: list = []
    for event, new_groups in canonical.items():
        arr = hooks.get(event)
        if not isinstance(arr, list):
            arr = []
        for g in new_groups:
            if g in arr:
                continue
            arr.append(g)
            added.append({"event": event, "group": g})
        hooks[event] = arr
    survivors = [r for r in prior if r in canon_flat]
    managed_now = survivors + [a for a in added if a not in survivors]
    if not added and not pruned:
        return path, managed_now   # already wired — leave the file untouched
    if had_comments:
        print(f"[geneseed] {path.name} has comments — not rewriting it (your edits are "
              f"kept). Add Geneseed's hooks by hand from adapters/claude-code/settings.json.",
              file=sys.stderr)
        return path, prior
    if hooks:
        config["hooks"] = hooks
    else:
        config.pop("hooks", None)
    path.parent.mkdir(parents=True, exist_ok=True)
    _atomic_write_json(path, config)
    return path, managed_now


def _unwire_claude_settings(path: Path, added: list) -> bool:
    """Reverse _merge_claude_settings: remove exactly the recorded hook groups, leaving
    the user's own keys and hooks intact. An emptied event key is dropped; an emptied
    `hooks` block is dropped. A commented settings.json is never rewritten. Returns
    True when the file was actually rewritten (the unwire landed), False when it
    bailed — so callers (uninstall) can report reality instead of assuming success;
    `_settings_integrity_check(expect='absent')` names the lingering groups."""
    if not path.exists() or not added:
        return False
    try:
        loaded, had_comments = _read_jsonc(path.read_text(encoding="utf-8"))
    except OSError:
        return False
    if had_comments or not isinstance(loaded, dict):
        return False
    hooks = loaded.get("hooks")
    if not isinstance(hooks, dict):
        return False
    for rec in added:
        event, group = rec.get("event"), rec.get("group")
        arr = hooks.get(event)
        if isinstance(arr, list) and group in arr:
            arr.remove(group)
        if isinstance(arr, list) and not arr:
            hooks.pop(event, None)
    if not hooks:
        loaded.pop("hooks", None)
    try:
        _atomic_write_json(path, loaded)
    except OSError:
        return False
    return True


def _wire_claude_excludes(path: Path, excludes: list) -> list:
    """Add absolute path(s) to a settings.json `claudeMdExcludes` array — Claude's native
    knob to skip a CLAUDE.md by path. A PROJECT install writes the GLOBAL same-host
    preamble here so it is suppressed while cwd is this repo (project-bypasses-global),
    and nowhere else (a project settings.json only merges in its own repo). Append-if-
    absent, every other key preserved, a commented file never rewritten (warned instead).
    Returns the entries actually written."""
    want = [e for e in (excludes or []) if e]
    if not want:
        return []
    config: dict = {}
    had_comments = False
    if path.exists():
        try:
            loaded, had_comments = _read_jsonc(path.read_text(encoding="utf-8"))
            if loaded is None:
                print(f"[geneseed] {path.name} is not valid JSON — NOT rewriting it "
                      f"(fix the syntax, then re-run). Excludes were not wired.",
                      file=sys.stderr)
                return []
            if isinstance(loaded, dict):
                config = loaded
        except OSError:
            pass
    cur = config.get("claudeMdExcludes")
    if not isinstance(cur, list):
        cur = []
    added = [e for e in want if e not in cur]
    if not added:
        return []
    if had_comments:
        print(f"[geneseed] {path.name} has comments — not rewriting it (your edits are "
              f'kept). Add to its "claudeMdExcludes" array by hand: {json.dumps(added)}',
              file=sys.stderr)
        return []
    cur.extend(added)
    config["claudeMdExcludes"] = cur
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        _atomic_write_json(path, config)
    except OSError as e:
        print(f"[geneseed] WARN: could not write {path} ({e}) — claudeMdExcludes "
              f"were not wired. Add to its \"claudeMdExcludes\" array by hand: "
              f"{json.dumps(added)}", file=sys.stderr)
        return []
    return added


def _unwire_claude_excludes(path: Path, excludes: list) -> None:
    """Reverse _wire_claude_excludes: remove exactly these paths from `claudeMdExcludes`,
    dropping the key when it empties. The user's own excludes and keys are untouched; a
    commented file is never rewritten."""
    if not path.exists() or not excludes:
        return
    try:
        loaded, had_comments = _read_jsonc(path.read_text(encoding="utf-8"))
    except OSError:
        return
    if had_comments or not isinstance(loaded, dict):
        return
    cur = loaded.get("claudeMdExcludes")
    if not isinstance(cur, list):
        return
    for e in excludes:
        if e in cur:
            cur.remove(e)
    if cur:
        loaded["claudeMdExcludes"] = cur
    else:
        loaded.pop("claudeMdExcludes", None)
    try:
        _atomic_write_json(path, loaded)
    except OSError:
        return


# ---- Settings integrity check -----------------------------------------------------
# Emit/unwire above are surgical (never rewrite a commented file, never touch a user's
# own keys), which means their success is NOT self-evident from "no exception was
# raised" — a `had_comments` bail-out silently leaves the file exactly as it was, an
# on-disk edit made between emit and this check would be invisible, and neither path
# re-reads the file to confirm the write actually stuck. This is the one shared checker
# BOTH directions (post-emit "is it wired", post-unwire "is it gone") and both call
# sites (the repo's `_build_*` generator AND the shipped `rituals/_harness_mcp.py`
# runtime, via `import build` — see build.py's submodule merge) can use without
# duplicating the JSONC read or the Geneseed-pattern sniff. Never raises: a mismatch is
# reported, not fatal — an uninstall/emit must finish even when the settings file
# turned out to be in a state the check didn't expect.
# Substrings that mark a hook command as Geneseed's. A TUPLE, not one string, because
# two shapes are in the wild and both must stay recognisable: the legacy direct form
# (interpreter + checkout harness.py) written by every install emitted before the shim,
# and the shim form. Dropping the legacy entry would make every not-yet-migrated install
# invisible to the orphan scan below — the one place a stranded hook can still surface.
# The shim marker is its FILENAME, not its directory, so a relocated GENESEED_HOME
# stays recognisable and no path-separator spelling has to be guessed.
_GENESEED_HOOK_SNIFF = ("harness.py", _SHIM_MARK)


def _settings_hook_groups(loaded: dict) -> "list[tuple[str, dict]]":
    """Flatten a loaded settings.json's `hooks` block to (event, group) pairs, mirroring
    the shape `_merge_claude_settings` records in the manifest (`{"event", "group"}`)."""
    hooks = loaded.get("hooks")
    if not isinstance(hooks, dict):
        return []
    out: "list[tuple[str, dict]]" = []
    for event, groups in hooks.items():
        if isinstance(groups, list):
            out.extend((event, g) for g in groups if isinstance(g, dict))
    return out


def _settings_integrity_check(path: Path, managed: dict, expect: str = "present") -> "list[str]":
    """Verify the settings file at `path` actually matches what the manifest's `managed`
    map claims was wired (expect='present', call after emit) or unwired
    (expect='absent', call after uninstall/deactivate). Returns a list of human-readable
    problem strings (empty == clean) and ALSO prints them as loud `[geneseed] WARN:`
    lines to stderr — callers don't need to re-format, just decide whether to act on a
    non-empty return. Never raises: a missing file is a finding for 'present' (and
    trivially clean for 'absent' — a deleted file satisfies "nothing left wired"), an
    unparseable one is always a finding, and a COMMENTED file IS still checked —
    `_read_jsonc` parses straight through the comments and this checker never writes,
    so the one settings state emit/unwire refuse to touch is exactly the one that
    must not escape verification (a bailed unwire leaves hooks firing there).

    Two independent checks:
      1. Every recorded `settings_hooks` group and `settings_excludes` entry is
         actually present (expect='present') or actually gone (expect='absent').
      2. Geneseed-PATTERN hook commands (matching any _GENESEED_HOOK_SNIFF marker —
         the legacy 'harness.py' form or the shim) that are NOT in the recorded claim
         set — flagged as a warning only, since they may be entries a user wrote
         themselves or an older install's claims this run didn't inherit; never
         auto-deleted."""
    problems: "list[str]" = []
    managed = managed if isinstance(managed, dict) else {}
    if not path.exists():
        if expect == "present":
            problems.append(f"{path}: file does not exist, but hooks/excludes were "
                             "supposed to be wired into it")
        # expect == 'absent': no file at all trivially satisfies "unwired".
        for p in problems:
            print(f"[geneseed] WARN: {p}", file=sys.stderr)
        return problems
    try:
        loaded, had_comments = _read_jsonc(path.read_text(encoding="utf-8"))
    except OSError as e:
        problems.append(f"{path}: could not read the file ({e})")
        for p in problems:
            print(f"[geneseed] WARN: {p}", file=sys.stderr)
        return problems
    # `had_comments` is deliberately NOT a bail-out: emit/unwire refuse to rewrite a
    # commented file (silently, on the unwire side), which is exactly how hooks can
    # linger after an uninstall — and this checker only reads, so comments cost nothing.
    del had_comments
    if not isinstance(loaded, dict):
        problems.append(f"{path}: not a JSON object — cannot verify hooks/excludes")
        for p in problems:
            print(f"[geneseed] WARN: {p}", file=sys.stderr)
        return problems

    present_groups = _settings_hook_groups(loaded)
    recorded_hooks = [r for r in (managed.get("settings_hooks") or []) if isinstance(r, dict)]
    # Plain `==` here (not the json.dumps(sort_keys=True) key the orphan scan below
    # uses) is deliberate, not an oversight: both sides are freshly `json.loads`-ed
    # dicts with no float/NaN content, so dict equality is already order-independent
    # and this is the simpler check. The orphan scan needs the dumped-string form
    # because it builds a set for O(1) membership, which a dict (unhashable) can't do.
    for rec in recorded_hooks:
        event, group = rec.get("event"), rec.get("group")
        hit = (event, group) in present_groups
        if expect == "present" and not hit:
            problems.append(f"{path}: recorded hook group missing — event={event!r} "
                             f"group={json.dumps(group)}")
        elif expect == "absent" and hit:
            problems.append(f"{path}: recorded hook group still present after unwire — "
                             f"event={event!r} group={json.dumps(group)}")

    excl_cur = loaded.get("claudeMdExcludes")
    excl_cur = excl_cur if isinstance(excl_cur, list) else []
    for entry in (managed.get("settings_excludes") or []):
        hit = entry in excl_cur
        if expect == "present" and not hit:
            problems.append(f"{path}: recorded claudeMdExcludes entry missing: {entry!r}")
        elif expect == "absent" and hit:
            problems.append(f"{path}: recorded claudeMdExcludes entry still present "
                             f"after unwire: {entry!r}")

    # Geneseed-PATTERN entries present but not in the recorded claim set — warn only,
    # never auto-delete (may be user-authored, or a claim this run legitimately didn't
    # inherit, e.g. a stale group already pruned by _merge_claude_settings elsewhere).
    recorded_set = {(r.get("event"), json.dumps(r.get("group"), sort_keys=True))
                    for r in recorded_hooks}
    for event, group in present_groups:
        key = (event, json.dumps(group, sort_keys=True))
        if key in recorded_set:
            continue
        cmds = [h.get("command", "") for h in (group.get("hooks") or []) if isinstance(h, dict)]
        if any(m in c for c in cmds for m in _GENESEED_HOOK_SNIFF):
            problems.append(f"{path}: Geneseed-pattern hook present but NOT recorded in "
                             f"the manifest (event={event!r}) — possibly user-authored; "
                             "left alone")

    for p in problems:
        print(f"[geneseed] WARN: {p}", file=sys.stderr)
    return problems


_BLOCK_BEGIN = "<!-- BEGIN {id} -->"
_BLOCK_END = "<!-- END {id} -->"


def _managed_block_write(path: Path, content: str, block_id: str = "GENESEED") -> str:
    """Write `content` into a single delimited managed block in `path`. Absent file ->
    create it whole (returns 'created'). Existing block -> replace it in place (returns
    'updated'). Otherwise append the block, preserving the user's prose around it
    (returns 'merged'). Idempotent: a re-emit replaces the block, never stacks them."""
    begin, end = _BLOCK_BEGIN.format(id=block_id), _BLOCK_END.format(id=block_id)
    block = f"{begin}\n{content.rstrip()}\n{end}\n"
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(block, encoding="utf-8")
        return "created"
    existing = path.read_text(encoding="utf-8")
    if begin in existing and end in existing:
        pre = existing.split(begin, 1)[0]
        post = existing.split(end, 1)[1]
        path.write_text(pre + block + post.lstrip("\n"), encoding="utf-8")
        return "updated"
    sep = "" if existing.endswith("\n") else "\n"
    path.write_text(existing + sep + "\n" + block, encoding="utf-8")
    return "merged"


def _managed_block_remove(path: Path, block_id: str = "GENESEED", whole: bool = False) -> None:
    """Reverse _managed_block_write. `whole` (Geneseed created the file) -> delete it.
    Otherwise excise just the delimited block, keeping the user's prose; a file left
    empty after excision is removed."""
    if not path.exists():
        return
    if whole:
        path.unlink()
        return
    begin, end = _BLOCK_BEGIN.format(id=block_id), _BLOCK_END.format(id=block_id)
    existing = path.read_text(encoding="utf-8")
    if begin not in existing or end not in existing:
        return
    pre = existing.split(begin, 1)[0]
    post = existing.split(end, 1)[1]
    rest = (pre.rstrip("\n") + "\n" + post.lstrip("\n")).strip()
    if rest:
        path.write_text(rest + "\n", encoding="utf-8")
    else:
        path.unlink()


def _managed_block_read(path: Path, block_id: str = "GENESEED") -> "str | None":
    """Return the inner content of the managed block in `path` (between the delimiters,
    exclusive), or None if absent. Lets a deactivate stash the block for an exact
    restore on reactivate without re-rendering."""
    if not path.exists():
        return None
    begin, end = _BLOCK_BEGIN.format(id=block_id), _BLOCK_END.format(id=block_id)
    text = path.read_text(encoding="utf-8")
    if begin not in text or end not in text:
        return None
    return text.split(begin, 1)[1].split(end, 1)[0].strip("\n")

