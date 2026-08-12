"""Geneseed harness — Build, doctor and prompt — render src/ and validate the bundle.

Part of the harness CLI (see harness.py). Imports the shared toolset from
_harness_core; cross-submodule names are linked at import time by harness.py,
so this file is only ever used through `import harness`."""
from __future__ import annotations

from _harness_core import *  # noqa: F401,F403  shared stdlib + primitives



def cmd_build(args: argparse.Namespace) -> int:
    extra = ["--theme", args.theme] if args.theme else []
    return run([sys.executable, str(BUILD), *extra]).returncode


# Default emit per (host, scope) when an install carries no `.geneseed-emit` marker
# (a pre-marker install) — used by rebuild-all to rebuild it in its own mode.
_DEFAULT_EMIT = {
    ("opencode", "global"): "opencode-global", ("opencode", "project"): "opencode",
    ("claude", "global"): "claude-global", ("claude", "project"): "claude",
    ("bob", "global"): "bob-global", ("bob", "project"): "bob",
    ("copilot", "global"): "copilot-global", ("copilot", "project"): "copilot",
}


def cmd_rebuild_all(args: argparse.Namespace) -> int:
    """Rebuild every ACTIVE install in place, best-effort: each is re-emitted in its
    own detected theme + emit (read from its markers), continuing past a failure so one
    broken install never blocks the rest. Disabled/absent installs are skipped (an
    absent row must never be CREATED by a rebuild). Returns non-zero if any failed."""
    targets = [(h, s, r) for h, s, r in _install_targets()
               if _install_state(r, h, s) == "active"]
    if not targets:
        print("[rebuild-all] no active installs detected.")
        return 0
    failures = []
    for host, scope, root in targets:
        em = root / ".geneseed-emit"
        marker = em.read_text(encoding="utf-8").strip() if em.is_file() else ""
        # ONE marker file per root, last deploy wins — in a dual-host repo
        # (.opencode + .claude in the same cwd) the other host's row would silently
        # rebuild with the WRONG emit. Trust the marker only for its own host.
        if marker and _EMIT_HOST_SCOPE.get(marker, ("", ""))[0] != host:
            marker = ""
        emit = marker or _DEFAULT_EMIT.get((host, scope), "opencode-global")
        theme = _theme_of_dir(root) or _default_theme()
        footprint = _footprint_of_dir(root)   # preserve lean/full — a rebuild must not flip it
        posture = _posture_of_dir(root) or _default_posture()   # preserve the register too
        mode = _mode_of_dir(root) or _default_mode()   # preserve the operating mode too
        out = None if scope == "global" else str(root)
        argv = _setup_build_args(theme, emit, out, out, footprint, posture, mode)
        label = f"{host}:{scope} ({root})"
        print(f"[rebuild-all] {label}: theme={theme} emit={emit} footprint={footprint} "
              f"posture={posture} mode={mode}")
        rc = run([sys.executable, str(BUILD), *argv]).returncode
        if rc != 0:
            failures.append(label)
            sys.stderr.write(f"[rebuild-all] FAILED {label} (exit {rc})\n")
    if failures:
        sys.stderr.write(f"[rebuild-all] {len(failures)}/{len(targets)} install(s) failed: "
                         f"{', '.join(failures)}\n")
        return 1
    print(f"[rebuild-all] rebuilt {len(targets)} install(s).")
    return 0


def _known_emits() -> frozenset:
    """Every emit name the generator answers to — the set an unrecognised marker is NOT in.

    A FUNCTION rather than a module-level constant on purpose: `_EMIT_HOST_SCOPE` lives in
    `_harness_mcp` and cross-submodule names are linked by `harness.py`'s splice AFTER every
    submodule has been imported, so evaluating it at import time raises NameError. Every
    other cross-module reference in this file is inside a function body for the same reason."""
    return frozenset(_EMIT_HOST_SCOPE)


def _hook_settings_file(root: Path, host: str, scope: str) -> "Path | None":
    """The settings file a host wires hook COMMANDS into, or None for a host with none.

    Only Claude and Bob carry hook commands. OpenCode's hooks are a PLUGIN (emitted JS that
    runs in the host's own process and names neither the shim nor harness.py) and Copilot has
    no hook mechanism at all, so both classify as 'none' and their whole migration is the
    re-emit — the same re-emit, in the same change, on all three hosts."""
    if host not in ("claude", "bob"):
        return None
    name = "settings.local.json" if scope == "project" and host != "bob" else "settings.json"
    return root / name


def _hook_commands_of(file: Path) -> "list[str]":
    """Every hook command string in a settings file; [] when unreadable or unparseable.

    `build._read_jsonc`, NOT `json.loads`. A hand-edited settings.json carrying comments and
    a trailing comma is the one shape no machine in this project writes, and strict JSON
    rejects it — which would classify a wired install as `none` and make `migrate` skip the
    machine silently. `_merge_claude_settings` already reads through comments for exactly
    this reason and `_settings_integrity_check`'s docblock says so out loud: the one settings
    state emit refuses to touch is precisely the one that must not escape verification.
    Found by the JSONC corpus fixture, which is the case a generated one would have hidden."""
    try:
        loaded, _had_comments = build._read_jsonc(file.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    if not isinstance(loaded, dict) or not isinstance(loaded.get("hooks"), dict):
        return []
    out: "list[str]" = []
    for groups in loaded["hooks"].values():
        if not isinstance(groups, list):
            continue
        for g in groups:
            if not isinstance(g, dict) or not isinstance(g.get("hooks"), list):
                continue
            out.extend(h["command"] for h in g["hooks"]
                       if isinstance(h, dict) and isinstance(h.get("command"), str))
    return out


def _migrate_stamp_path() -> Path:
    """`<GENESEED_HOME>/.migrated` — the ROOT the last successful migration installed from."""
    return build._shim_home() / ".migrated"


def _migrate_stash_dir() -> Path:
    return build._shim_home() / ".migrate-backup"


def _migrate_survey() -> dict:
    """Classify every active install WITHOUT touching anything.

    A refusal raised here is free — nothing has been written, so "refuse and report" needs no
    rollback. That ordering is the cheapest atomicity there is, and it is why the survey is a
    separate pass rather than a check inside the re-emit loop."""
    rows, commands, unrecognised = [], [], []
    for host, scope, root in _install_targets():
        if _install_state(root, host, scope) != "active":
            continue
        em = root / ".geneseed-emit"
        marker = em.read_text(encoding="utf-8").strip() if em.is_file() else ""
        # An unrecognised marker is a REFUSAL, not a default. `cmd_rebuild_all` coerces here.
        if marker and marker not in _known_emits():
            unrecognised.append((host, scope, root, marker))
            continue
        file = _hook_settings_file(root, host, scope)
        if file is not None:
            commands.extend(_hook_commands_of(file))
        rows.append((host, scope, root, marker, file))
    try:
        shim_body = build._hook_shim_path().read_text(encoding="utf-8")
    except OSError:
        shim_body = ""
    shape = build._migrate_shape(commands, shim_body)
    try:
        stamped = _migrate_stamp_path().read_text(encoding="utf-8").strip()
    except OSError:
        stamped = ""
    # THE TRIGGER IS THE STAMP, AND THE SHAPE IS REPORTED. The first draft had it the other
    # way round and the ref-vs-ref self-check killed it in one run: `shape == "legacy"` cannot
    # be a trigger, because what "current" MEANS is "the shim body names the .mjs entry", and
    # THIS implementation bakes python + harness.py by design (`_hook_runner_entry`). A
    # migration run from the reference could never reach `current`, its second run would
    # re-emit forever, and the two implementations would diverge on idempotence by
    # construction. The stamp is a value both sides write and read identically.
    return {"rows": rows, "unrecognised": unrecognised, "shape": shape,
            "needed": stamped != str(ROOT)}


def _autostart_findings() -> "list[Path]":
    """Hand-written login entries naming another checkout. Reported, never rewritten."""
    out = []
    for p in build._autostart_paths():
        try:
            text = p.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        if build._autostart_stale(text, ROOT):
            out.append(p)
    return out


def _stash_key(p: Path) -> str:
    """A backup name that cannot collide across drives and is legal on both platforms."""
    return re.sub(r"[\\/:]", "_", str(p))


def cmd_migrate(args: argparse.Namespace) -> int:
    """Move this machine from the git-checkout install shape to the npm shim shape.

    P10d, AND IT IS NOT A PORT — new behaviour, written on both implementations in the same
    change so `tests/harness_golden.py` (a CROSS-implementation gate) has a reference side.

    IT IS NOT `rebuild-all` EITHER, and that was checked before being discarded. The re-emit
    is the same engine and is reused; four behaviours differ, and each is a cell:

      * an unrecognised emit marker  — rebuild-all COERCES to a default; migrate REFUSES.
        Coercion is right for a rebuild and is *guessing what the user installed* here.
      * a failing root — rebuild-all continues (one broken install must not block the rest);
        migrate ROLLS EVERYTHING BACK, because a half-migrated machine is the failure this
        verb exists to prevent.
      * an already-migrated machine — rebuild-all re-emits; migrate writes NOTHING.
      * stale autostart entries — not a rebuild's subject; surveyed and reported here.

    TWO TRIGGERS, AND IT TAKES BOTH. Work is needed when the wiring is `legacy` (and shapes 2
    and 3 differ only inside the shim BODY, never in the settings file — see
    `build._migrate_shape`) OR when the stamp does not name this ROOT. Neither alone is
    enough: an OpenCode-only machine wires no hooks, so its shape is permanently 'none' and a
    shape-only trigger re-emits it forever; and a user who reinstalls the old Python build
    flips the shape back to 'legacy' while the stamp still matches, and must migrate again."""
    survey = _migrate_survey()
    rows, unrecognised = survey["rows"], survey["unrecognised"]

    if unrecognised:
        # Refuse the WHOLE run. Skipping the row we did not understand and migrating the rest
        # is exactly the half-migrated machine this verb exists to prevent.
        sys.stderr.write("[migrate] REFUSED — unrecognised install marker(s):\n")
        for host, scope, root, marker in unrecognised:
            sys.stderr.write(f"[migrate]   {host}:{scope} ({root}) has .geneseed-emit "
                             f"'{marker}', which is not an emit this generator answers to.\n")
        sys.stderr.write("[migrate] Nothing was changed. Fix or delete the marker, "
                         "then re-run.\n")
        return 3

    if not rows:
        print("[migrate] no active installs detected.")
        return 0

    if not survey["needed"]:
        print(f"[migrate] already on the npm shape ({len(rows)} install(s)); nothing to do.")
        return 0

    print(f"[migrate] {len(rows)} install(s), wiring shape: {survey['shape']}")
    if args.dry_run:
        for host, scope, root, _marker, _file in rows:
            print(f"[migrate] would re-emit {host}:{scope} ({root})")
        for p in _autostart_findings():
            print(f"[migrate] would report the autostart entry at {p}")
        print("[migrate] --dry-run: nothing was written.")
        return 0

    # Stash every file the re-emit can touch, so the rollback below can put it all back.
    stash, saved = _migrate_stash_dir(), []
    try:
        shutil.rmtree(stash, ignore_errors=True)
        stash.mkdir(parents=True, exist_ok=True)
        targets = [f for _h, _s, _r, _m, f in rows if f is not None]
        for p in targets + [build._hook_shim_path()]:
            if not p.exists():
                continue
            dest = stash / _stash_key(p)
            shutil.copyfile(p, dest)
            saved.append((p, dest))
    except OSError as e:
        sys.stderr.write(f"[migrate] could not stage a backup ({e}); nothing was changed.\n")
        return 1

    def _restore() -> None:
        for orig, dest in saved:
            try:
                shutil.copyfile(dest, orig)
            except OSError:
                pass          # best effort — the failure is reported by the caller regardless
        shutil.rmtree(stash, ignore_errors=True)

    for host, scope, root, marker, _file in rows:
        if marker and _EMIT_HOST_SCOPE.get(marker, ("", ""))[0] != host:
            marker = ""
        emit = marker or _DEFAULT_EMIT.get((host, scope), "opencode-global")
        theme = _theme_of_dir(root) or _default_theme()
        out = None if scope == "global" else str(root)
        argv = _setup_build_args(theme, emit, out, out, _footprint_of_dir(root),
                                 _posture_of_dir(root) or _default_posture(),
                                 _mode_of_dir(root) or _default_mode())
        label = f"{host}:{scope} ({root})"
        print(f"[migrate] re-emitting {label}: theme={theme} emit={emit}")
        rc = run([sys.executable, str(BUILD), *argv]).returncode
        if rc != 0:
            # ALL OR NOTHING. `cmd_rebuild_all` continues here on purpose; a migration must
            # not, or the machine is left half on each shape.
            sys.stderr.write(f"[migrate] FAILED {label} (exit {rc}) — rolling back.\n")
            _restore()
            sys.stderr.write(f"[migrate] rolled back {len(saved)} file(s); "
                             "the install is unchanged.\n")
            return 1

    shutil.rmtree(stash, ignore_errors=True)
    try:
        stamp = _migrate_stamp_path()
        stamp.parent.mkdir(parents=True, exist_ok=True)
        stamp.write_text(f"{ROOT}\n", encoding="utf-8")
    except OSError:
        pass      # an unwritable stamp costs a redundant re-emit next run, never correctness

    print(f"[migrate] migrated {len(rows)} install(s).")

    # What could NOT be fixed automatically. Reported, never rewritten: nothing in this
    # repository has ever written an autostart entry, so migrate does not own the file.
    # The `start` ACTION is load-bearing, not decoration: bare `web` runs `serve()` in the
    # FOREGROUND with `daemon=False`, which never calls `write_daemon`, so `web stop`,
    # `web restart` and `web status` stay blind to the server this note just told someone to
    # launch at every login. Derived, not trusted: `TheMigrateNoteAdvisesARealWebAction`.
    for p in _autostart_findings():
        print(f"[migrate] NOTE: the autostart entry at {p} still names another checkout — "
              "update it by hand to run: geneseed web start --no-browser")
    return 0


def _link_problems(md: Path, text: str, out: Path, rel: Path) -> list[str]:
    """Dead links AND non-hermetic links — any target that leaves the bundle.
    Hermeticity (DESIGN Decision 5) is the invariant that lets the bundle be
    copied/subtree-split into any repo; a link escaping `out` silently breaks it."""
    problems: list[str] = []
    for link in LINK_RE.findall(strip_code(text)):
        raw = link.split("#", 1)[0].strip()
        if not raw:
            continue
        if ABS_LINK_RE.match(raw):
            problems.append(f"non-hermetic absolute link '{link}' in {rel}")
            continue
        target = (md.parent / raw).resolve()
        if not target.exists():
            problems.append(f"dead link '{link}' in {rel}")
        elif not _within(target, out):
            problems.append(f"non-hermetic link '{link}' escapes the bundle in {rel}")
    return problems


def _check_build(theme_name: str, out: Path, is_vendored=build.is_vendored_path) -> list[str]:
    """Scan one rendered bundle for unresolved tokens, dead links, and escapes.

    `is_vendored` defaults to `build.is_vendored_path` (assumes a `files`/opencode-
    global bundle-relative path, `skills/<name>/...`). Per-repo native layers
    (`.claude/skills/<name>/...`, `.bob/skills/<name>/...`) nest one level deeper, so
    callers scanning those pass `build._validate_is_vendored` instead — see
    `_claude_bob_emit_problems`."""
    out = out.resolve()
    problems: list[str] = []
    for md in out.rglob("*.md"):
        rel = md.relative_to(out)
        # Vendored third-party skill folders are verbatim upstream docs: their internal
        # cross-links reference the upstream project's own (partly un-vendored) files and
        # they carry their own license, so they are exempt from Geneseed's hermeticity /
        # dead-link invariant. (See build.VENDORED_SKILL_DIRS for the vendored set.)
        if is_vendored(rel):
            continue
        text = md.read_text(encoding="utf-8")
        for tok in set(TOKEN_RE.findall(text)):
            problems.append(f"[{theme_name}] unresolved token {tok} in {rel}")
        problems += [f"[{theme_name}] {p}" for p in _link_problems(md, text, out, rel)]
    return problems


def _theme_parity_problems() -> list[str]:
    """Every theme must define the same VOICE keys. A token present in one theme but
    absent from another renders as a raw {{TOKEN}} only in the files that use it, and
    only under that theme — a plain build can miss it. Compare the maps directly."""
    themes: dict[str, dict] = {}
    for p in build.theme_files():
        try:
            themes[p.stem] = json.loads(p.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError) as e:
            return [f"[themes] {p.name} unreadable: {e}"]
    if len(themes) < 2:
        return []
    allkeys = set().union(*(set(t) for t in themes.values()))
    problems: list[str] = []
    for name, t in themes.items():
        for k in sorted(allkeys - set(t)):
            problems.append(f"[themes] '{name}' missing key {{{k}}} (defined in another theme)")
    return problems


_HEX_RE = re.compile(r"^#[0-9a-fA-F]{6}$")


def _color_theme_problems() -> list[str]:
    """Every curated colour theme (themes/opencode/*.json) must carry the full palette —
    a role missing from one theme leaves a slot unfilled only in that theme's emit. Each
    palette value must be a 6-digit hex. Mirrors voice-theme parity, for colours."""
    problems: list[str] = []
    palettes: dict[str, dict] = {}
    for p in build.color_theme_files():
        try:
            spec = json.loads(p.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError) as e:
            problems.append(f"[colors] {p.name} unreadable: {e}")
            continue
        pal = spec.get("palette")
        if not isinstance(pal, dict):
            problems.append(f"[colors] {p.name} has no 'palette' object")
            continue
        palettes[spec.get("name", p.stem)] = pal
        for role in sorted(build._PALETTE_ROLES - set(pal)):
            problems.append(f"[colors] '{p.stem}' palette missing role '{role}'")
        for role, val in pal.items():
            if not (isinstance(val, str) and _HEX_RE.match(val)):
                problems.append(f"[colors] '{p.stem}' role '{role}' is not #rrggbb hex: {val!r}")
    return problems


def _resolve_themes_dir(args: argparse.Namespace) -> Path:
    """Where to write a user theme: an explicit --dir, else the per-repo
    ./.opencode/themes (if a .opencode/ exists here), else OpenCode's global config
    themes dir. This is where OpenCode itself reads themes from, so `/theme <name>`
    just works."""
    if getattr(args, "dir", None):
        return Path(args.dir).expanduser().resolve()
    repo = Path.cwd() / ".opencode"
    if not getattr(args, "global_dir", False) and repo.is_dir():
        return repo / "themes"
    return build._opencode_config_dir() / "themes"


def _load_user_palette(args: argparse.Namespace) -> dict:
    """Assemble a palette from --from (a shipped theme to clone) overlaid with --palette
    (a JSON file, either {"palette": {...}} or a bare role->hex map). Validated against
    the same role set and hex rule the shipped themes use."""
    pal: dict = {}
    if getattr(args, "from_theme", None):
        src = build.COLOR_THEMES / f"{args.from_theme}.json"
        if not src.is_file():
            avail = ", ".join(p.stem for p in build.color_theme_files())
            raise SystemExit(f"[theme] no shipped theme '{args.from_theme}'. available: {avail}")
        pal.update(json.loads(src.read_text(encoding="utf-8")).get("palette", {}))
    if getattr(args, "palette", None):
        raw = json.loads(Path(args.palette).read_text(encoding="utf-8"))
        pal.update(raw.get("palette", raw))   # accept {"palette":{…}} or a bare map
    if not pal:
        raise SystemExit("[theme] need a palette: pass --from <shipped> and/or --palette <file.json>")
    missing = sorted(build._PALETTE_ROLES - set(pal))
    if missing:
        raise SystemExit(f"[theme] palette missing role(s): {', '.join(missing)} "
                         f"(see themes/opencode/README.md; --from seeds them all)")
    bad = [f"{r}={pal[r]!r}" for r in pal if not (isinstance(pal[r], str) and _HEX_RE.match(pal[r]))]
    if bad:
        raise SystemExit(f"[theme] non-#rrggbb value(s): {', '.join(bad)}")
    return pal


def cmd_theme(args: argparse.Namespace) -> int:
    """Write a user colour theme (both flavours) into the live OpenCode themes dir. The
    name is branded with the `geneseed-` prefix so every harness theme groups together in
    the picker; a rebuild still never erases it — preservation keys off the emit set, not
    the prefix (spec §8.2). Select it in OpenCode with `/theme geneseed-<name>`."""
    name = args.name
    full = name if name.startswith("geneseed-") else f"geneseed-{name}"
    pal = _load_user_palette(args)
    dest_dir = _resolve_themes_dir(args)
    dest_dir.mkdir(parents=True, exist_ok=True)
    flavours = [("", False)] if args.solid_only else \
               [("-transparent", True)] if args.transparent_only else \
               [("", False), ("-transparent", True)]
    written = []
    for suffix, transparent in flavours:
        dest = dest_dir / f"{full}{suffix}.json"
        dest.write_text(json.dumps(build._color_theme_json(pal, transparent), indent=2) + "\n",
                        encoding="utf-8")
        written.append(dest)
    print(f"[theme] wrote {', '.join(p.name for p in written)} to {dest_dir}")
    print(f"[theme] select in OpenCode with: /theme {full}"
          + ("" if args.solid_only else f"  (or /theme {full}-transparent)"))
    return 0


def _rendered_problems(bundle: Path) -> list[str]:
    """A committed bundle (e.g. ./Harness) must match a fresh render of src/ for its
    own recorded theme, or it has silently drifted — doctor's tmp builds never touch
    it. Render src/ in memory and compare only the files that come FROM src/ (AGENT.md,
    the laws, agents, skills, memory/README…). Host-state files (context.json,
    MEMORY.md, the .geneseed-* markers) are created once and never rendered, so they
    are not in the render set and are correctly ignored. Notebook files (except its
    `.gitignore`) are seed-once and agent-owned after the first build (spec
    2026-06-11) — a difference there is the agent's own rewrite, not drift, so they
    are compared only for existence."""
    if not bundle.is_dir():
        return []
    marker = bundle / ".geneseed-theme"
    if marker.exists():
        theme_name = marker.read_text(encoding="utf-8").strip()
    elif build.CONFIG.exists():
        theme_name = json.loads(build.CONFIG.read_text(encoding="utf-8")).get("theme", "neutral")
    else:
        theme_name = "neutral"
    # Render the comparison copy with the footprint the bundle was ACTUALLY built
    # with, read from its own marker — exactly as the theme is read above. Assuming
    # a footprint here would report every file as drifted the moment the build
    # default moved, which is a diagnosis about this function, not about the bundle.
    #
    # ...and in the DIALECT it was emitted in, read from its own `.geneseed-emit`
    # marker, for the same reason again. A bundle is not always the portable one: a host
    # that catalogues skills and agents to the model itself gets AGENT.md's tables
    # collapsed to a pointer (`native_catalog`), and the OpenCode emits additionally
    # strip the per-row spec links. Rendering the portable shape and comparing it against
    # an OpenCode bundle reports AGENT.md as stale on EVERY run, and no rebuild can ever
    # clear it — the emit puts the difference back by design. `harness.py diff` already
    # avoids this exact trap (see `_harness_diff._diff_collect`); this check did not.
    # An absent or unrecognised marker means the portable `files` bundle, which is what
    # `native_catalog=False` and no stripping describe.
    try:
        emit = (bundle / ".geneseed-emit").read_text(encoding="utf-8").strip()
    except OSError:
        emit = ""
    host = _EMIT_HOST_SCOPE.get(emit, ("", ""))[0]
    try:
        _theme, items = build.render_all(theme_name,
                                         _footprint_of_dir(bundle),
                                         native_catalog=build.host_catalogs_natively(host))
    except SystemExit:
        return [f"[rendered] cannot render theme '{theme_name}' for {bundle.name}/"]
    problems: list[str] = []
    nb_dirname = build.STRUCTURE.get("DIR_NOTEBOOK", "notebook")
    for out_rel, text, src in items:
        dest = bundle / out_rel
        rel = Path(out_rel)
        if not dest.exists():
            problems.append(f"[rendered] {bundle.name}/{out_rel} missing — rebuild the bundle")
        elif rel.parts[0] == nb_dirname and rel.name != ".gitignore":
            continue   # seed-once, agent-owned: a rewrite is not drift
        elif text is not None:
            # The OpenCode emits de-link AGENT.md's per-row agent/skill table entries
            # after rendering (OpenCode never follows those hrefs), so the bundle on disk
            # legitimately differs from `render_all`'s output for this one file.
            if host == "opencode" and out_rel == "AGENT.md":
                text = build._strip_capability_links(text)
            if dest.read_text(encoding="utf-8") != text:
                problems.append(f"[rendered] {bundle.name}/{out_rel} stale (differs from a fresh render) — rebuild")
        elif dest.read_bytes() != src.read_bytes():
            problems.append(f"[rendered] {bundle.name}/{out_rel} stale — rebuild")
    return problems


def _authoring_problems() -> list[str]:
    """Author-time gates on the source specs and plugins (not rendered output):
    every agent/skill spec must carry a one-line '>' purpose blockquote as the FIRST
    content block after its title (else its OpenCode `description:` — and every host's
    frontmatter description, all built from `desc_of`/`_first_blockquote` — either
    renders empty or silently picks up the WRONG line, since `_first_blockquote` finds
    the first '>' line anywhere in the file, not necessarily the intended one); the
    learn-prompt literal must stay extractable from the plugin (the single-source link
    harness.py depends on); and, if node is on PATH, the plugins must pass
    `node --check`. Then three source-wide gates: the lifecycle registry must describe
    exactly the entities src/ provides, no credential may appear in anything that
    ships, and every vendored skill folder must carry an immutable upstream pin."""
    problems: list[str] = []
    for folder in ("agents", "skills"):
        d = build.SRC / folder
        if not d.is_dir():
            continue
        for spec in sorted(d.glob("*.md")):
            if spec.name.startswith("_"):
                continue
            try:
                text = spec.read_text(encoding="utf-8")
            except OSError as e:
                problems.append(f"[authoring] {folder}/{spec.name} unreadable: {e}")
                continue
            if not build._first_blockquote(text):
                problems.append(f"[authoring] {folder}/{spec.name} has no '>' purpose line "
                                f"(its OpenCode description would render empty)")
                continue
            reason = build._desc_block_problem(text)
            if reason:
                problems.append(f"[authoring] {folder}/{spec.name}: {reason} — "
                                f"desc_of() would silently extract the wrong description")
    plugin = build.PLUGIN_SRC / "geneseed-learn.js"
    try:
        m = re.search(r"const LEARN_PROMPT_HEAD = `([\s\S]*?)`",
                      plugin.read_text(encoding="utf-8"))
    except OSError:
        m = None
    if not m:
        problems.append("[authoring] LEARN_PROMPT_HEAD literal not found in "
                        "geneseed-learn.js — harness.py would fall back (single source broken)")
    elif m.group(1) != LEARN_PROMPT_HEAD:
        problems.append("[authoring] LEARN_PROMPT_HEAD drifted between geneseed-learn.js "
                        "and harness.py's loaded copy")
    node = shutil.which("node")
    if node:
        for js in sorted(build.PLUGIN_SRC.glob("*.js")):
            r = run([node, "--check", str(js)], capture_output=True, text=True)
            if r.returncode != 0:
                tail = (r.stderr.strip().splitlines() or ["syntax error"])[-1]
                problems.append(f"[authoring] node --check failed for {js.name}: {tail}")
    problems += _registry_problems()
    problems += _secret_problems()
    problems += _vendor_pin_problems()
    problems += _count_table_problems()
    return problems


def _src_stems(folder: str) -> set:
    """Spec stems under src/<folder>, minus `_`-prefixed scaffolds."""
    d = build.SRC / folder
    return {p.stem for p in d.glob("*.md") if not p.name.startswith("_")} if d.is_dir() else set()


def _registry_keys() -> set:
    """Every entity the registry must describe: the flat agent and skill specs plus the
    vendored skill FOLDERS (which have no flat spec but are still shipped capabilities).
    Keyed "<folder>/<stem>", the path shape doctor already prints in its messages."""
    keys = {f"agents/{s}" for s in _src_stems("agents")}
    keys |= {f"skills/{s}" for s in _src_stems("skills")}
    return keys | {f"skills/{d}" for d in build.VENDORED_SKILL_DIRS}


_SEMVER_RE = re.compile(r"^\d+\.\d+\.\d+$")
_ISO_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _registry_problems() -> list[str]:
    """registry.json must describe exactly the entities src/ provides, with well-formed
    fields. Same two-way anti-drift shape as the SKILL_CLASS gate below: a new spec with
    no row, and a row whose spec is gone, are both errors — without it a shipped skill
    would show no lifecycle status in the TUI/web catalog while doctor stayed green.
    `last_verified` may be empty (nothing writes it yet); when set, it must be a date."""
    from _harness_tui import ENTITY_STATUSES
    try:
        doc = json.loads((ROOT / "registry.json").read_text(encoding="utf-8"))
    except OSError as e:
        return [f"[authoring] registry.json unreadable: {e}"]
    except ValueError as e:
        return [f"[authoring] registry.json is not valid JSON: {e}"]
    entities = doc.get("entities") if isinstance(doc, dict) else None
    if not isinstance(entities, dict):
        return ["[authoring] registry.json has no 'entities' object"]
    expected = _registry_keys()
    problems = [f"[authoring] {key} has no row in registry.json"
                for key in sorted(expected - set(entities))]
    problems += [f"[authoring] registry.json lists '{key}' but no such entity exists"
                 for key in sorted(set(entities) - expected)]
    for key in sorted(expected & set(entities)):
        row = entities[key]
        if not isinstance(row, dict):
            problems.append(f"[authoring] registry.json['{key}'] is not an object")
            continue
        if row.get("status") not in ENTITY_STATUSES:
            problems.append(f"[authoring] registry.json['{key}'].status {row.get('status')!r} "
                            f"is not one of {list(ENTITY_STATUSES)}")
        if not _SEMVER_RE.match(str(row.get("version", ""))):
            problems.append(f"[authoring] registry.json['{key}'].version "
                            f"{row.get('version')!r} is not a semver (N.N.N)")
        if not str(row.get("owner", "")).strip():
            problems.append(f"[authoring] registry.json['{key}'] has no owner")
        for field in ("added", "last_verified"):
            value = str(row.get(field, ""))
            if value and not _ISO_DATE_RE.match(value):
                problems.append(f"[authoring] registry.json['{key}'].{field} {value!r} is "
                                f"not an ISO date (YYYY-MM-DD) or empty")
    return problems


# Credential shapes, by the prefix each issuer stamps on its own tokens, plus the generic
# `secret = "…"` assignment. Deliberately narrow: a gate that cries wolf gets disabled.
_SECRET_PATTERNS = (
    ("Anthropic API key", re.compile(r"sk-ant-[A-Za-z0-9_-]{20,}")),
    ("OpenAI-style API key", re.compile(r"\bsk-[A-Za-z0-9]{32,}")),
    ("GitHub token", re.compile(r"\bgh[pousr]_[A-Za-z0-9]{36}\b")),
    ("AWS access key id", re.compile(r"\bAKIA[0-9A-Z]{16}\b")),
    ("Slack token", re.compile(r"\bxox[abprs]-[A-Za-z0-9-]{10,}")),
    ("private key block", re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----")),
    ("assigned credential", re.compile(
        r"(?i)\b(password|passwd|secret|api[_-]?key|access[_-]?token)\s*[:=]\s*"
        r"[\"'][^\"'\s]{8,}[\"']")),
)


def _secret_problems() -> list[str]:
    """No credential may ship. Sweeps the four trees `source_fingerprint()` hashes —
    src/, themes/, the OpenCode plugins and workflows — which is exactly the material
    that ends up inside a user's bundle. Reports file:line and the KIND of match only:
    echoing the matched text would republish the secret into every CI log."""
    problems: list[str] = []
    for root in (build.SRC, build.THEMES, build.PLUGIN_SRC, build.WORKFLOW_SRC):
        if not root.is_dir():
            continue
        for path in sorted(root.rglob("*")):
            if not path.is_file() or "__pycache__" in path.parts:
                continue
            try:
                text = path.read_text(encoding="utf-8")
            except (OSError, UnicodeDecodeError):
                continue  # binary or unreadable — nothing to scan
            try:
                rel = path.relative_to(ROOT).as_posix()
            except ValueError:
                rel = path.as_posix()  # scanning a tree outside the repo (a test tmpdir)
            for i, line in enumerate(text.splitlines(), 1):
                for label, pattern in _SECRET_PATTERNS:
                    if pattern.search(line):
                        problems.append(f"[authoring] possible {label} in {rel}:{i} — a "
                                        f"credential must never be committed")
    return problems


def _shim_problems() -> list[str]:
    """The hook shim must exist and must point at a harness.py that is actually there.

    This gate exists because the shim DISARMED an accidental safety net. When the
    emitted hook command still carried the checkout path, moving the checkout made that
    command non-canonical, so the next emit's prune-and-rewire repaired every install by
    itself. Now the config is invariant under a move and the stale path lives in the shim
    body — which no other gate reads, since the build scan only walks *.md. Without this
    check a moved checkout would leave every gate silently dead: the hooks still fire,
    the shim still runs, and the interpreter reports "no such file" into a channel
    nobody reads.

    Absent shim is NOT a problem: a source checkout that has never emitted anything has
    no reason to own one, and `_hook_prefix` falls back to the direct form when it cannot
    write one. Only a shim that exists and is broken is worth reporting."""
    p = build._hook_shim_path()
    if not p.is_file():
        return []
    try:
        body = p.read_text(encoding="utf-8")
    except OSError as e:
        return [f"[shim] {p} exists but cannot be read ({e}) — hooks may be dead"]
    # The body is machine-generated and quotes the two baked paths — plus, on POSIX, the
    # argv placeholder `"$@"`, which is not a path and never was one. `build._SHIM_ARGV` is
    # the single owner of that pair; see it for what this line reported on every non-Windows
    # host until the harnesses were first run on Linux.
    quoted = re.findall(r'"([^"]+)"', body)
    missing = [q for q in quoted if q not in build._SHIM_ARGV and not Path(q).exists()]
    if missing:
        return [f"[shim] {p} pointed at {m}, which does not exist — every hook in every "
                f"install was dead (the checkout most likely moved). This run's own "
                f"emit has refreshed it; no further action needed." for m in missing]
    return []


_HEX40_RE = re.compile(r"^[0-9a-f]{40}$")
# Refs that move under the pin. Re-copying the folder months later would then change the
# shipped skill with nothing in the diff to explain it.
_MOVING_REFS = {"main", "master", "develop", "dev", "head", "latest", "trunk"}


def _vendor_pin_problems() -> list[str]:
    """Every vendored skill folder must record where it came from, under which license,
    and at WHICH immutable commit. First-party folders that merely ride the vendored
    mechanism for their multi-file layout (token-report) declare that instead and are
    exempt from the pin — there is no upstream to drift against."""
    problems: list[str] = []
    for name in build.VENDORED_SKILL_DIRS:
        folder = build.SRC / "skills" / name
        if not folder.is_dir():
            problems.append(f"[authoring] VENDORED_SKILL_DIRS lists '{name}' but "
                            f"src/skills/{name}/ does not exist")
            continue
        try:
            text = (folder / "VENDOR.md").read_text(encoding="utf-8")
        except OSError:
            problems.append(f"[authoring] skills/{name}/ has no VENDOR.md — its upstream, "
                            f"pinned commit and license are unrecorded")
            continue
        if not re.search(r"\*\*License:\*\*", text):
            problems.append(f"[authoring] skills/{name}/VENDOR.md records no '**License:**'")
        upstream = re.search(r"\*\*Upstream:\*\*\s*(\S+)", text)
        if not upstream:
            problems.append(f"[authoring] skills/{name}/VENDOR.md declares no '**Upstream:**'")
            continue
        if upstream.group(1).lower().startswith("this"):
            continue  # first-party — no upstream to pin against
        pin = re.search(r"\*\*Commit:\*\*\s*(\S+)", text)
        if not pin:
            problems.append(f"[authoring] skills/{name}/VENDOR.md has no '**Commit:**' pin")
        elif pin.group(1).lower() in _MOVING_REFS:
            problems.append(f"[authoring] skills/{name}/VENDOR.md pins '{pin.group(1)}', a "
                            f"moving branch — record the commit sha instead")
        elif not _HEX40_RE.match(pin.group(1).lower()):
            problems.append(f"[authoring] skills/{name}/VENDOR.md pin '{pin.group(1)}' is not "
                            f"a 40-character commit sha")
    return problems


_ROMAN_VALUES = {"I": 1, "V": 5, "X": 10, "L": 50, "C": 100, "D": 500, "M": 1000}


def _roman_to_int(num: str) -> int:
    """Roman numeral → int. Law headings number in Roman; the web ledger keys its
    per-rule display copy by the Arabic equivalent, so the gate has to bridge the two.
    Returns 0 on an unparseable numeral, which surfaces as a gate problem rather than
    a crash."""
    total = prev = 0
    for ch in reversed(num.upper()):
        v = _ROMAN_VALUES.get(ch)
        if v is None:
            return 0
        total += -v if v < prev else v
        prev = max(prev, v)
    return total


# A LAW_META row in the web Laws page: `<arabic>: ['<class>', '<principle>'],`.
# Either quote style — a principle carrying an apostrophe is double-quoted. Every
# `\s*` spans newlines and a trailing comma before `]` is optional, so a row prettier
# has wrapped across several lines still matches: a row too long for the print width
# gets reflowed with a magic trailing comma, and a gate that only understood the
# one-line form silently lost it — leaving the law's Principle unguarded while
# `format:check` and this gate demanded contradictory formatting of the same file.
_LAW_META_ROW = re.compile(
    r"(?m)^\s*(\d+):\s*\[\s*(['\"])(.*?)\2\s*,\s*(['\"])(.*?)\4\s*,?\s*\]\s*,?\s*$")


def _law_meta_problems(law_nums: list[str], law_class: dict[str, str],
                       law_classes: tuple[str, ...]) -> list[str]:
    """Keep the web Laws ledger's per-rule display copy complete. `LAW_META` in
    web/src/pages/Laws.jsx holds each law's one-line Principle — copy that exists
    nowhere else in the tree — and a law with no row there falls back to
    `['craft', '']`: the rule renders with a blank description and the wrong class
    chip. Nothing else notices, because everything upstream is fine — the catalog API
    still serves the law, the page still renders, LAW_CLASS is complete, doctor and
    both suites stay green. That is exactly how Laws XXXVI and XXXVII shipped
    description-less. So assert one row per rule in universal.md, a non-empty
    principle, a known class, no stale row, and agreement with LAW_CLASS."""
    page = ROOT / "web" / "src" / "pages" / "Laws.jsx"
    try:
        text = page.read_text(encoding="utf-8")
    except OSError as e:
        return [f"[authoring] web/src/pages/Laws.jsx unreadable: {e}"]
    block = re.search(r"(?m)^const LAW_META = \{$(.*?)^\}$", text, re.S)
    if not block:
        return ["[authoring] LAW_META literal not found in web/src/pages/Laws.jsx — the web "
                "Laws ledger's Principle column would have no gate"]
    meta = {int(m.group(1)): (m.group(3), m.group(5))
            for m in _LAW_META_ROW.finditer(block.group(1))}
    problems: list[str] = []
    seen: set[int] = set()
    for roman in law_nums:
        n = _roman_to_int(roman)
        seen.add(n)
        if n not in meta:
            problems.append(f"[authoring] laws/universal.md rule {roman} ({n}) has no row in "
                            f"LAW_META (web/src/pages/Laws.jsx) — the web Laws ledger would "
                            f"render it with a blank Principle")
            continue
        klass, principle = meta[n]
        if not principle.strip():
            problems.append(f"[authoring] LAW_META[{n}] has an empty principle line — rule "
                            f"{roman} would render with a blank description")
        if klass not in law_classes:
            problems.append(f"[authoring] LAW_META[{n}] class '{klass}' is not a known class "
                            f"{list(law_classes)}")
        elif law_class.get(roman) and klass != law_class[roman]:
            problems.append(f"[authoring] LAW_META[{n}] classes rule {roman} as '{klass}' but "
                            f"LAW_CLASS says '{law_class[roman]}'")
    for n in sorted(set(meta) - seen):
        problems.append(f"[authoring] LAW_META lists rule {n} but laws/universal.md has no such rule")
    return problems


def _prose_mirror_problems(readme: str, web: str, counts: dict[str, int],
                           skill_stems: set[str], shipped: str = "") -> list[str]:
    """Keep the *human-readable* count mirrors honest — the ones the badge regex never
    sees. The README "What you get" table and the web onboarding copy each restate the
    law / agent / skill counts in prose, and the README enumerates the skills by name.
    Nothing renders these, so they drift silently (they already had). Assert every such
    mirror against the derived src/ counts. Pure over its inputs, so a test can feed it
    crafted drift without touching the tree."""
    problems: list[str] = []
    laws, agents, skills = counts["laws"], counts["agents"], counts["skills"]
    plugins = counts.get("plugins")

    # README prose: "N universal laws".
    for n in re.findall(r"(\d+) universal laws", readme):
        if int(n) != laws:
            problems.append(f"[authoring] README prose says '{n} universal laws' but src has {laws}")
    # README prose: "N plugins". This one had drifted — the overview sentence said six
    # while seven shipped, and the row below it listed all seven. The project's OTHER
    # plugin count, the web docs' {N_PLUGINS}, reads a DEPLOYED plugins dir, which a
    # markdown file in this repository never has; so this mirror had no derived source
    # and nothing to notice it. `plugins` is optional in `counts` because the corpus
    # predates it.
    if plugins is not None:
        for n in re.findall(r"(\d+) \*{0,2}plugins", readme):
            if int(n) != plugins:
                problems.append(f"[authoring] README prose says '{n} plugins' but "
                                f"adapters/opencode/plugins has {plugins}")
    # README "What you get" table rows: **🤖 Agents** (N) and **🛠 Skills** (N).
    for label, want in (("Agents", agents), ("Skills", skills)):
        m = re.search(rf"{label}\*\*\s*\((\d+)\)", readme)
        if m and int(m.group(1)) != want:
            problems.append(f"[authoring] README '{label} ({m.group(1)})' but src has {want}")
    # The README Skills row must enumerate EXACTLY the source skills — a dropped name is
    # invisible to the (N) count alone, which is the off-by-one this gate now forbids.
    row = next((ln for ln in readme.splitlines() if "🛠" in ln and "Skills" in ln), "")
    if "workflows:" in row:
        listed = {re.sub(r"[^a-z0-9-]", "", seg) for seg in row.split("workflows:", 1)[1].split("·")}
        listed.discard("")
        for missing in sorted(skill_stems - listed):
            problems.append(f"[authoring] README skills list omits '{missing}'")
        for orphan in sorted(listed - skill_stems):
            problems.append(f"[authoring] README skills list names '{orphan}' but no skills/{orphan}.md exists")

    # _web_core onboarding prose: law count ("N universal laws"/"N universal Rules") and
    # agent count ("N capability specialists").
    for n in re.findall(r"(\d+) universal (?:laws|Rules)", web):
        if int(n) != laws:
            problems.append(f"[authoring] _web_core prose says '{n} universal laws/Rules' but src has {laws}")
    for n in re.findall(r"(\d+) capability specialists", web):
        if int(n) != agents:
            problems.append(f"[authoring] _web_core prose says '{n} capability specialists' but src has {agents}")
    # _web_core skills page states "N repeatable workflows … — [[a]], [[b]], …". N is a
    # curated-subset size (not the total), so gate it against the wikilinks it introduces.
    m = re.search(r"(\d+) repeatable workflows the agent can invoke by name(.*?)playbook under", web, re.S)
    if m:
        listed_n = len(re.findall(r"\[\[[^\]]+\]\]", m.group(2)))
        if int(m.group(1)) != listed_n:
            problems.append(f"[authoring] _web_core says '{m.group(1)} repeatable workflows' "
                            f"but its wikilink list has {listed_n}")

    # SHIPPED.md capability row: "N laws, N agents, N skills" sits under the explicit
    # promise "Every row below is present in the tree today" — it had drifted 1 law /
    # 6 skills behind src/ with no gate to notice.
    m = re.search(r"(\d+) laws, (\d+) agents, (\d+) skills", shipped)
    if m:
        for got, want, label in ((m.group(1), laws, "laws"), (m.group(2), agents, "agents"),
                                 (m.group(3), skills, "skills")):
            if int(got) != want:
                problems.append(f"[authoring] SHIPPED.md says '{got} {label}' but src has {want}")
    return problems


def _count_table_problems() -> list[str]:
    """Keep the hand-authored AGENT.md capability tables and the README count badges
    honest against src/: the agent/skill tables must list EXACTLY the spec files (no
    dead row, no orphaned spec), and each `agents`/`skills`/`laws`/`themes` badge must
    equal the real count. The prose count mirrors (README "What you get" table + web
    onboarding copy) are folded in via `_prose_mirror_problems`. This is the authoring-
    time guarantee that lets those tables, badges, and prose stay hand-written without
    silently drifting from the source tree."""
    problems: list[str] = []
    tmpl = build.SRC / "AGENT.md.tmpl"
    try:
        ttext = tmpl.read_text(encoding="utf-8")
    except OSError as e:
        return [f"[authoring] AGENT.md.tmpl unreadable: {e}"]

    # Per-row links are tokenised in the template, e.g. `[reviewer]({{DIR_AGENTS}}/reviewer.md)`.
    linked = {"agents": set(), "skills": set()}
    for kind, name in re.findall(r"\{\{DIR_(AGENTS|SKILLS)\}\}/([A-Za-z0-9_-]+)\.md", ttext):
        if name != "_template":
            linked["agents" if kind == "AGENTS" else "skills"].add(name)
    for folder in ("agents", "skills"):
        files = _src_stems(folder)
        for missing in sorted(linked[folder] - files):
            problems.append(f"[authoring] AGENT.md links {folder}/{missing}.md but no such spec exists")
        for orphan in sorted(files - linked[folder]):
            problems.append(f"[authoring] {folder}/{orphan}.md exists but the AGENT.md table omits it")

    # Every skill must carry a category in SKILL_CLASS (drives the web Skills
    # ledger's filter chips). Same anti-drift guard as the AGENT.md table above.
    from _harness_tui import SKILL_CLASS
    skill_files = _src_stems("skills")
    for missing in sorted(skill_files - set(SKILL_CLASS)):
        problems.append(f"[authoring] skills/{missing}.md has no category in SKILL_CLASS (_harness_tui.py)")
    for stale in sorted(set(SKILL_CLASS) - skill_files):
        problems.append(f"[authoring] SKILL_CLASS lists '{stale}' but no skills/{stale}.md exists")

    # Every law must carry a governance class in LAW_CLASS (drives the web Laws
    # ledger's filter chips), and that class must be one of the known six. Same
    # anti-drift guard as SKILL_CLASS above: without it a new law silently falls
    # back to "craft" in the TUI/web while doctor and the suite stay green — the
    # gap that let Law XXXV ship mis-classified until caught by eye.
    from _harness_tui import LAW_CLASS, LAW_CLASSES
    laws_md = build.SRC / "laws" / "universal.md"
    law_nums = re.findall(r"(?m)^### \{\{LAW\}\} ([IVXLCDM]+)\b",
                          laws_md.read_text(encoding="utf-8")) if laws_md.is_file() else []
    for num in law_nums:
        if num not in LAW_CLASS:
            problems.append(f"[authoring] laws/universal.md rule {num} has no class in LAW_CLASS (_harness_tui.py)")
    for num, klass in sorted(LAW_CLASS.items()):
        if klass not in LAW_CLASSES:
            problems.append(f"[authoring] LAW_CLASS['{num}'] = '{klass}' is not a known class {list(LAW_CLASSES)}")
    problems += _law_meta_problems(law_nums, LAW_CLASS, LAW_CLASSES)

    # README capability badges must match the real counts.
    counts = {
        "agents": len(_src_stems("agents")),
        "skills": len(_src_stems("skills")),
        "laws": len(law_nums),
        "themes": len(build.theme_files()),
        # Last on purpose: the badge loop below walks this dict in order and the message
        # sequence is compared byte for byte against the Node implementation.
        "plugins": len(list(build.PLUGIN_SRC.glob("geneseed-*.js"))),
    }
    try:
        readme = (ROOT / "README.md").read_text(encoding="utf-8")
    except OSError:
        return problems
    for key, n in counts.items():
        m = re.search(rf"badge/{key}-(\d+)", readme)
        if m and int(m.group(1)) != n:
            problems.append(f"[authoring] README {key} badge says {m.group(1)} but src has {n}")

    # Beyond the badges, the same counts are mirrored in hand-written prose (README table
    # + web onboarding). Those had no gate and had drifted; assert them too.
    try:
        web = (ROOT / "rituals" / "_web_core.py").read_text(encoding="utf-8")
    except OSError:
        web = ""
    try:
        shipped = (ROOT / "SHIPPED.md").read_text(encoding="utf-8")
    except OSError:
        shipped = ""
    problems += _prose_mirror_problems(readme, web, counts, skill_files, shipped)
    return problems


def _themes_to_check(theme, all_themes, detected, available):
    """Which themes doctor validates. An explicit --theme wins. Otherwise, unless
    --all forces the full maintainer sweep, scope to the theme THIS host installed
    (detected from the deployed marker/sigil) so a user who installed one theme is
    not buried under the same problem echoed across all eight. Falls back to the
    full sweep when nothing is installed (a fresh clone) or the detected theme is
    unknown — so a maintainer in a clean checkout still gets full coverage."""
    if theme:
        return [theme]
    if not all_themes and detected and detected in available:
        return [detected]
    return sorted(available)


def _global_emit_problems(theme_name: str) -> list[str]:
    """Validate the opencode-global emit — the RECOMMENDED install, and otherwise a
    doctor blind spot (the files build and ./Harness were checked; the global layout
    never was). Render it into a throwaway config dir and scan AGENT.md, the native
    agents/skills, and the seeded memory store for unresolved tokens, dead links, and
    non-hermetic escapes — exactly as for a files build. Labelled '<theme> global' so
    a problem here is distinguishable from the plain build.

    Both footprints are rendered. They produce genuinely different AGENT.md bodies —
    lean swaps the inlined laws for a generated digest plus a pointer, and ships a
    standalone laws file the full emit does not write — so checking only one leaves
    the other's links and tokens unvalidated. Lean being the default made that the
    shape most installs actually run. ~0.3s per render, so the pair is cheap."""
    problems: list[str] = []
    for footprint in ("lean", "full"):
        with tempfile.TemporaryDirectory() as tmp:
            cfg = Path(tmp) / "cfg"
            try:
                with contextlib.redirect_stdout(io.StringIO()):   # swallow the emit's log
                    build.emit_opencode_global(theme_name, out=Path(tmp) / "bundle",
                                               cfg=cfg, footprint=footprint)
            except SystemExit:
                problems.append(f"[{theme_name} global/{footprint}] build failed")
                continue
            problems += _check_build(f"{theme_name} global/{footprint}", cfg)
    return problems


def _claude_bob_emit_problems(theme_name: str) -> list[str]:
    """Validate the claude/bob/copilot PER-REPO emits — never checked before (only the
    `files` build and opencode-global were), which is exactly why the CLAUDE.md/AGENTS.md
    skill-table dead links (`.claude/skills/<name>.md`) shipped unnoticed: the emits
    that render CLAUDE.md/AGENTS.md straight into a repo were outside doctor's sweep.
    Renders `emit_claude`, `emit_bob` and `emit_copilot` into throwaway sandboxes (mirroring
    `build.py --validate-only`'s own scan, but called in-process — NOT by shelling to
    `--validate-only`, which itself shells BACK into `doctor --no-bundle` and would
    recurse) and scans each with `_check_build`, using `build._validate_is_vendored`
    (tolerant of a `skills` segment at any depth) instead of the bundle-relative
    `build.is_vendored_path` — the native per-repo layer nests skills one level
    deeper than a `files`/opencode-global bundle (`.claude/skills/<name>/...` /
    `.bob/skills/<name>/...`, vs `skills/<name>/...`)."""
    problems: list[str] = []
    for label, emit_fn in (("claude", build.emit_claude), ("bob", build.emit_bob),
                           ("copilot", build.emit_copilot)):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "root"
            sandbox = root / "bundle"
            try:
                with contextlib.redirect_stdout(io.StringIO()):   # swallow the emit's log
                    emit_fn(theme_name, sandbox, root)
            except SystemExit:
                problems.append(f"[{theme_name} {label}] build failed")
                continue
            problems += _check_build(f"{theme_name} {label}", root,
                                     is_vendored=build._validate_is_vendored)
    return problems


# ----------------------------------------------------------------- the CLI reference
#
# `harness.build_argparser()` is 25 subparsers (26 invocable names — `update` aliases
# `upgrade`) and 46 `add_argument` calls, and it USED to be the only description of the CLI
# either implementation had. Node cannot introspect argparse, so P10c made the metadata a FILE
# both sides read: the web console's `cli` docs page (`_web_docs._cli_reference`) and
# `bin/geneseed-cli.mjs`'s own argument parser, whose `VERBS` table used to carry a second
# hand-written transcription of the same calls.
#
# P2 MOVED THAT FILE AND CHANGED ITS OWNER. It is `js/cli-table.json` now — a product path,
# because `package.json`'s `files[]` already ships `js/` and a document npm ships does not
# belong in `tests/` — and it is no longer GENERATED from this parser. It is the owned
# document, and this module is one of its READERS, on the same footing as `js/cli.mjs`.
#
# WHAT WENT WITH THE MOVE. `cli_source_digest`/`_cli_reference_problems` hashed
# `rituals/harness.py` and doctor reported drift on both binaries when the parser moved without
# a regeneration. That digest was a claim about the file this migration deletes, and there is no
# generator left to fall behind. `tests/test_cli_reference.py` holds the argparse-vs-table
# EQUALITY — the gate a digest never could, since it also sees a hand edit — for as long as the
# parser is here to be walked. After that the table is simply the source of truth.

CLI_JSON = ROOT / "js" / "cli-table.json"

#: The keys the docs PAGE has always carried, per argument. `_cli_arg` produces two more for
#: `bin/geneseed-cli.mjs` (`type`, `hidden`) and the page is filtered back to exactly this set
#: so the response the tracked `web/dist` renders is byte-for-byte what it was before.
_PAGE_ARG_KEYS = ("names", "dest", "metavar", "help", "choices", "default",
                  "required", "nargs", "is_flag")


def _cli_arg(a) -> dict:
    return {
        "names": list(a.option_strings),
        "dest": a.dest,
        "metavar": a.metavar,
        "help": "" if a.help is argparse.SUPPRESS else (a.help or ""),
        "choices": list(a.choices) if a.choices else None,
        "default": None if a.default is None else
                   (a.default if isinstance(a.default, (str, int, float, bool))
                    else str(a.default)),
        "required": bool(getattr(a, "required", False)),
        "nargs": str(a.nargs) if a.nargs is not None else None,
        "is_flag": bool(a.option_strings) and a.nargs == 0,
        # The two fields the page never needed and the Node entry cannot work without.
        # `type=int` is what makes `--port abc` a refusal instead of a silent fallback to
        # 4747; `hidden` is `help=argparse.SUPPRESS`, and the walk used to DROP those
        # arguments entirely — four of which bind real values (`upgrade ref`, `sync-self
        # ref`, `bootstrap extra`, `web --daemon-internal`, the last passed 95 times a run
        # by tests/web_golden.py).
        "type": getattr(a.type, "__name__", None) if a.type is not None else None,
        "hidden": a.help is argparse.SUPPRESS,
    }


def build_cli_reference(parser: argparse.ArgumentParser) -> dict:
    """Walk an argparser into a JSON-able shape: one entry per subcommand, with its help
    text, positionals, options and mutually-exclusive groups.

    Takes the parser rather than calling `harness.build_argparser()` itself, and that is not
    style: `rituals/harness.py` runs as `__main__`, so an `import harness` from one of its own
    submodules would load the module a SECOND time under its real name and re-run the splice.
    Nothing inside the harness process needs this function — the generator and the tests do,
    and both reach it through a normal `import harness`.

    THE FULL PARSER, hidden arguments included; `load_cli_reference` is what filters it down
    to the page. `sub.choices` carries argparse's ALIASES as keys of their own, so `update`
    appears beside `upgrade` with an empty help — the help text lives on the parent's
    pseudo-action, which is registered under the canonical name only. That is what this walk
    has always produced and both readers depend on it: the Node entry dispatches `update` as
    a row of its own."""
    sub_action = next((a for a in parser._actions
                       if isinstance(a, argparse._SubParsersAction)), None)
    if sub_action is None:
        return {"prog": parser.prog, "commands": []}

    commands = []
    for name, sp in sub_action.choices.items():
        positionals, options = [], []
        for a in sp._actions:
            if isinstance(a, argparse._HelpAction):
                continue
            (positionals if not a.option_strings else options).append(_cli_arg(a))
        # The help text we attached via sub.add_parser(..., help=...) lives on the
        # subparser action, not on sp itself — read it back from the parent.
        help_text = ""
        for action in sub_action._choices_actions:
            if action.dest == name:
                help_text = action.help or ""
                break
        # `add_mutually_exclusive_group()`. Group membership lives on the GROUP, not on the
        # action, so it cannot be part of `_cli_arg`. Only `theme` has one, and without this
        # the Node entry would accept `--solid-only --transparent-only` where argparse
        # refuses it. Declaration order, not sorted: it is the order the refusal names them
        # in.
        mutex = [[o for ga in g._group_actions for o in ga.option_strings]
                 for g in sp._mutually_exclusive_groups]
        commands.append({
            "name": name,
            "help": help_text,
            "description": sp.description or "",
            "positionals": positionals,
            "options": options,
            "mutex": [m for m in mutex if m],
        })
    commands.sort(key=lambda c: c["name"])
    return {"prog": parser.prog, "commands": commands}


#: The exact bytes `js/cli-table.json` carries for a given parser — the serialisation
#: `tests/test_cli_reference.py` compares the committed table against. It is a FUNCTION and not
#: a comment because the equality is over bytes, not over a parsed dict: key order and
#: indentation are part of what a hand edit can break.
def serialise_cli_reference(parser: argparse.ArgumentParser) -> str:
    return json.dumps(build_cli_reference(parser), indent=2, ensure_ascii=False) + "\n"


def load_cli_reference() -> dict:
    """The CLI table as the docs page consumes it: the file minus the arguments argparse
    hides, minus the two fields the page never carried.

    THE PAGE IS A VIEW OF THE FILE, not the other way round. `bin/geneseed-cli.mjs` needs the
    hidden arguments and the page must not show them, so the file carries everything and each
    reader filters. An unreadable file answers with the empty reference rather than a 500 —
    doctor is what reports it, on both binaries."""
    try:
        data = json.loads(CLI_JSON.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"prog": "harness", "commands": []}
    return {
        "prog": data.get("prog", "harness"),
        "commands": [{
            "name": c.get("name", ""),
            "help": c.get("help", ""),
            "description": c.get("description", ""),
            "positionals": _page_args(c.get("positionals", [])),
            "options": _page_args(c.get("options", [])),
        } for c in data.get("commands", [])],
    }


def _page_args(args: list) -> list:
    return [{k: a.get(k) for k in _PAGE_ARG_KEYS} for a in args if not a.get("hidden")]


def _doctor_collect(theme=None, all_themes=False, bundle=None, no_bundle=False,
                    on_progress=None, groups=None):
    """Run every doctor check; return (themes, sorted_unique_problems). on_progress
    (i, total, label) is called as it advances, so a caller can draw a progress bar.
    `groups`, when a caller passes a list, is filled with one
    {check, label, problems} dict per check run — the structured view the web
    Doctor page renders — without changing this function's return contract.

    Theme scope: with no explicit `theme` and without `all_themes`, validation is
    scoped to the installed theme (detected from the deployed bundle), not the full
    sweep — see `_themes_to_check`. The cross-theme PARITY check below runs
    regardless of scope, so the guarantee that motivated the sweep (a voice token
    present in one theme map but missing in another) is never lost."""
    available = [p.stem for p in build.theme_files()]
    if not available:
        return [], ["[doctor] no themes found"]

    def _ran(check: str, label: str, probs: list) -> list:
        if groups is not None:
            groups.append({"check": check, "label": label, "problems": sorted(probs)})
        return probs

    # Only probe the deployed install when we actually need it (no theme / not --all).
    detected = None if (theme or all_themes) else _installed_defaults().get("theme")
    themes = _themes_to_check(theme, all_themes, detected, available)
    # Sampled HERE, before the emit loop below — every emit rewrites the hook shim, so a
    # check placed after them could only ever observe the freshly repaired file and would
    # be dead code that always reports clean. Reported in its usual slot further down.
    shim_probs = _shim_problems()
    total = len(themes) + 1
    problems: list[str] = []
    with tempfile.TemporaryDirectory() as tmp:
        for i, theme_name in enumerate(themes):
            if on_progress:
                on_progress(i, total, f"theme: {theme_name}")
            out = Path(tmp) / theme_name
            rc = run([sys.executable, str(BUILD), "--theme", theme_name, "--out", str(out)],
                     cwd=ROOT, capture_output=True, text=True).returncode
            if rc != 0:
                problems += _ran("build", f"Build scan ({theme_name})",
                                 [f"[{theme_name}] build failed"])
                continue
            problems += _ran("build", f"Build scan ({theme_name})",
                             _check_build(theme_name, out))
            problems += _ran("global", f"Global install ({theme_name})",
                             _global_emit_problems(theme_name))
            problems += _ran("claude_bob", f"Claude/Bob/Copilot per-repo emit ({theme_name})",
                             _claude_bob_emit_problems(theme_name))
    if on_progress:
        on_progress(len(themes), total, "parity · authoring · bundle")
    problems += _ran("parity", "Theme parity", _theme_parity_problems())
    problems += _ran("colors", "Colour themes", _color_theme_problems())
    problems += _ran("authoring", "Authoring gates", _authoring_problems())
    problems += _ran("shim", "Hook shim", shim_probs)
    # P10c's `cli` check is GONE — it hashed `rituals/harness.py` against a digest baked into
    # `cli.json`, and P2 made the table the owned document with no generator behind it. See
    # the CLI reference section above; `js/doctor.mjs` carries the same note.
    if not no_bundle:
        b = Path(bundle).expanduser().resolve() if bundle else ROOT / "Harness"
        problems += _ran("bundle", "Committed bundle drift", _rendered_problems(b))
    if on_progress:
        on_progress(total, total, "done")
    return themes, sorted(set(problems))


def cmd_doctor(args: argparse.Namespace) -> int:
    """Validate the build. With --theme, checks that one theme. With no theme it
    scopes to the INSTALLED theme (so a one-theme install is not buried under the
    same issue repeated across every theme); pass --all for the full maintainer sweep
    of every theme. The cross-theme parity check runs in every mode."""
    all_themes = getattr(args, "all", False)
    themes, problems = _doctor_collect(theme=args.theme, all_themes=all_themes,
                                       bundle=args.bundle, no_bundle=args.no_bundle)
    if not themes:
        print(problems[0] if problems else "[doctor] no themes found")
        return 1
    scoped = not args.theme and not all_themes and len(themes) == 1
    note = (f"  (scoped to installed theme '{themes[0]}'; run with --all to sweep "
            f"every theme)" if scoped else "")
    if problems:
        print(f"[doctor] {len(problems)} problem(s) across {len(themes)} theme(s):")
        for p in problems:
            print("  -", p)
        if any("dead link" in p for p in problems):
            print("  tip: dead links to skills mean your source is incomplete — run "
                  "`./geneseed update` (or re-sync src/), then re-check.")
        if any(p.startswith("[themes]") and "missing key" in p for p in problems):
            print("  tip: a theme is missing a key another theme defines — run "
                  "`python build.py --sync-themes` to fill it from _TEMPLATE.json, "
                  "then restyle the added key(s) and re-check.")
        if note:
            print(note)
        return 1
    print(f"[doctor] ok — {len(themes)} theme(s) clean: no unresolved tokens, no dead "
          f"links, nothing escapes the bundle; themes in parity; specs carry purpose "
          f"lines; rendered bundle in sync")
    if note:
        print(note)
    return 0


def _fence_for(text: str) -> str:
    """A backtick fence longer than the longest backtick run inside `text`, so
    embedded code fences never close the wrapper. Minimum four."""
    longest = run = 0
    for ch in text:
        run = run + 1 if ch == "`" else 0
        longest = max(longest, run)
    return "`" * max(4, longest + 1)


def build_prompt(theme_name: str) -> str:
    _, items = build.render_all(theme_name)
    n_text = sum(1 for _, t, _ in items if t is not None)
    out = [
        f"# Geneseed Harness — install prompt (theme: {theme_name})",
        "",
        "You are an AI agent. Recreate the Geneseed harness file tree below, writing",
        "every file **verbatim**. No Python or build step is required.",
        "",
        "## Target directory",
        "Write all files under the directory the user specifies. If none was given, ask",
        "for it, defaulting to the current repository root. Preserve the exact relative",
        "path shown in each file heading, creating subfolders as needed.",
        "",
        "## Rules",
        "- Copy each file's content exactly — do not summarise, reflow, or edit it.",
        "- After writing, create an empty context.json at the repo root if absent, and list the repo's docs in it.",
        "- When finished, list every file you created.",
        "",
        f"## Files ({n_text} text files)",
    ]
    for out_rel, text, _src in items:
        if text is None:
            out.append(f"\n### `{out_rel}` (binary — copy it from the Geneseed repo)")
            continue
        fence = _fence_for(text)
        out += [f"\n### `{out_rel}`", "", fence, text.rstrip("\n"), fence]
    return "\n".join(out) + "\n"


def cmd_prompt(args: argparse.Namespace) -> int:
    text = build_prompt(args.theme or "neutral")
    if args.out:
        dest = Path(args.out)
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(text, encoding="utf-8")
        print(f"[prompt] wrote {args.out} ({args.theme or 'neutral'})")
    else:
        sys.stdout.write(text)
    return 0
