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
        emit = (em.read_text(encoding="utf-8").strip() if em.is_file() else None) \
            or _DEFAULT_EMIT.get((host, scope), "opencode-global")
        theme = _theme_of_dir(root) or _default_theme()
        out = None if scope == "global" else str(root)
        argv = _setup_build_args(theme, emit, out, out)
        label = f"{host}:{scope} ({root})"
        print(f"[rebuild-all] {label}: theme={theme} emit={emit}")
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


def _check_build(theme_name: str, out: Path) -> list[str]:
    """Scan one rendered bundle for unresolved tokens, dead links, and escapes."""
    out = out.resolve()
    problems: list[str] = []
    for md in out.rglob("*.md"):
        rel = md.relative_to(out)
        # Vendored third-party skill folders are verbatim upstream docs: their internal
        # cross-links reference the upstream project's own (partly un-vendored) files and
        # they carry their own license, so they are exempt from Geneseed's hermeticity /
        # dead-link invariant. (See build.VENDORED_SKILL_DIRS for the vendored set.)
        if build.is_vendored_path(rel):
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
    try:
        _theme, items = build.render_all(theme_name)
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
            if dest.read_text(encoding="utf-8") != text:
                problems.append(f"[rendered] {bundle.name}/{out_rel} stale (differs from a fresh render) — rebuild")
        elif dest.read_bytes() != src.read_bytes():
            problems.append(f"[rendered] {bundle.name}/{out_rel} stale — rebuild")
    return problems


def _authoring_problems() -> list[str]:
    """Author-time gates on the source specs and plugins (not rendered output):
    every agent/skill spec must carry a one-line '>' purpose blockquote (else its
    OpenCode `description:` renders empty); the learn-prompt literal must stay
    extractable from the plugin (the single-source link harness.py depends on); and,
    if node is on PATH, the plugins must pass `node --check`."""
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
    problems += _count_table_problems()
    return problems


def _src_stems(folder: str) -> set:
    """Spec stems under src/<folder>, minus `_`-prefixed scaffolds."""
    d = build.SRC / folder
    return {p.stem for p in d.glob("*.md") if not p.name.startswith("_")} if d.is_dir() else set()


def _count_table_problems() -> list[str]:
    """Keep the hand-authored AGENT.md capability tables and the README count badges
    honest against src/: the agent/skill tables must list EXACTLY the spec files (no
    dead row, no orphaned spec), and each `agents`/`skills`/`laws`/`themes` badge must
    equal the real count. This is the authoring-time guarantee that lets those tables
    and badges stay hand-written without silently drifting from the source tree."""
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

    # README capability badges must match the real counts.
    laws_md = build.SRC / "laws" / "universal.md"
    counts = {
        "agents": len(_src_stems("agents")),
        "skills": len(_src_stems("skills")),
        "laws": len(re.findall(r"(?m)^### \{\{LAW\}\} ", laws_md.read_text(encoding="utf-8")))
        if laws_md.is_file() else 0,
        "themes": len(build.theme_files()),
    }
    try:
        readme = (ROOT / "README.md").read_text(encoding="utf-8")
    except OSError:
        return problems
    for key, n in counts.items():
        m = re.search(rf"badge/{key}-(\d+)", readme)
        if m and int(m.group(1)) != n:
            problems.append(f"[authoring] README {key} badge says {m.group(1)} but src has {n}")
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
    a problem here is distinguishable from the plain build."""
    with tempfile.TemporaryDirectory() as tmp:
        cfg = Path(tmp) / "cfg"
        try:
            with contextlib.redirect_stdout(io.StringIO()):   # swallow the emit's log
                build.emit_opencode_global(theme_name, out=Path(tmp) / "bundle", cfg=cfg)
        except SystemExit:
            return [f"[{theme_name} global] build failed"]
        return _check_build(f"{theme_name} global", cfg)


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
    if on_progress:
        on_progress(len(themes), total, "parity · authoring · bundle")
    problems += _ran("parity", "Theme parity", _theme_parity_problems())
    problems += _ran("colors", "Colour themes", _color_theme_problems())
    problems += _ran("authoring", "Authoring gates", _authoring_problems())
    if not no_bundle:
        b = Path(bundle).expanduser().resolve() if bundle else ROOT / "Harness"
        problems += _ran("bundle", "Committed bundle drift", _rendered_problems(b))
    if on_progress:
        on_progress(total, total, "done")
    return themes, sorted(set(problems))


def cmd_doctor(args: argparse.Namespace) -> int:
    """Validate the build. With --theme, checks that one theme. With no theme it
    scopes to the INSTALLED theme (so a one-theme install is not buried under the
    same issue repeated across all eight); pass --all for the full maintainer sweep
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
