"""Geneseed web — the Docs/Specs API: doc-page slicing, spec index, CLI
reference, glossary, about.

Part of the web API (see web.py). Imports the shared toolset from _web_core."""
from __future__ import annotations

from _web_core import *  # noqa: F401,F403  shared stdlib + primitives


# ---- Docs API --------------------------------------------------------------


def _find_doc_page(page_id: str) -> "dict | None":
    """Look up a page by id across all groups. Used by /api/docs/page/<id>."""
    for g in DOC_GROUPS:
        for p in g["pages"]:
            if p["id"] == page_id:
                return p
    return None


def _read_doc_source(rel: str) -> str:
    """Read a markdown file relative to ROOT — guards against escapes the same
    way Library does, then returns the body unmodified (frontmatter and all)."""
    target = (ROOT / rel).resolve()
    if not harness._within(target, ROOT) or not target.is_file():
        raise NotFound(rel)
    return target.read_text(encoding="utf-8", errors="replace")


# ---- Harness filtering -----------------------------------------------------
# The Docs UI carries a Claude-Code / OpenCode selector so a reader sees only
# the wiring that applies to their host. ~80% of the docs are shared, so we
# don't split the tree — we tag only what differs, at two granularities:
#   - page/group: a DOC_GROUPS page (or whole group) gets `"harness": "..."`;
#     api_docs() drops it from the menu when it doesn't match.
#   - inline: a span inside an otherwise-shared body is wrapped in HTML-comment
#     markers `<!--harness:opencode-->...<!--/harness-->` (invisible to GitHub
#     readers of the canonical SETUP.md/README.md), stripped here per host.

_HARNESSES = ("opencode", "claude")
_HARNESS_OPEN_RE = re.compile(r"^\s*<!--\s*harness:(opencode|claude)\s*-->\s*$")
_HARNESS_CLOSE_RE = re.compile(r"^\s*<!--\s*/harness\s*-->\s*$")
# Cheap presence test for the early-out — must never be narrower than the open
# regex above (any whitespace after `<!--`), or a stray-spaced marker would slip
# the guard and leak unstripped.
_HARNESS_HINT_RE = re.compile(r"<!--\s*harness:")


def _norm_harness(value: "str | None", state: "WebState") -> str:
    """Resolve a requested harness to one of _HARNESSES. An explicit, valid
    value wins; otherwise default to the installed host (claude only when the
    deployed emit is a Claude bundle, else OpenCode — the common case)."""
    v = (value or "").strip().lower()
    if v in _HARNESSES:
        return v
    return "claude" if (getattr(state, "emit", "") or "").startswith("claude") else "opencode"


def _harness_blocks_balanced(lines: list) -> bool:
    """True when every `<!--harness:X-->` has a matching `<!--/harness-->` with
    no nesting — the only shape _strip_harness_blocks can filter safely. Markers
    inside a ``` code fence are example text, not real markers (same rule as
    _slice_section). Used to fail open (leave the body untouched) on a malformed
    marker rather than silently blanking the rest of a page."""
    open_, in_fence = False, False
    for line in lines:
        if line.startswith("```"):
            in_fence = not in_fence
            continue
        if in_fence:
            continue
        if _HARNESS_OPEN_RE.match(line):
            if open_:
                return False            # nested open
            open_ = True
        elif _HARNESS_CLOSE_RE.match(line):
            if not open_:
                return False            # close with no open
            open_ = False
    return not open_                    # no dangling open


def _strip_harness_blocks(body: str, harness_name: str) -> str:
    """Drop `<!--harness:X-->...<!--/harness-->` blocks whose X != harness_name
    and unwrap (keep the inner lines, drop the markers) the ones that match.
    Line-based and nesting-free — markers must sit on their own line, and a
    marker inside a ``` fence is left alone (example text, like _slice_section).
    Malformed (unbalanced / nested) markers fail open: the body is returned
    untouched so a typo never blanks a page — and the
    test_every_doc_body_has_balanced_markers unit test catches an imbalance in CI
    before it ships (there is no separate doctor check)."""
    if not _HARNESS_HINT_RE.search(body):
        return body
    lines = body.splitlines()
    if not _harness_blocks_balanced(lines):
        return body
    out, keep, in_fence = [], True, False
    for line in lines:
        if line.startswith("```"):
            in_fence = not in_fence
            if keep:
                out.append(line)
            continue
        if not in_fence:
            m = _HARNESS_OPEN_RE.match(line)
            if m:
                keep = (m.group(1) == harness_name)
                continue
            if _HARNESS_CLOSE_RE.match(line):
                keep = True
                continue
        if keep:
            out.append(line)
    return "\n".join(out)


def _visible_groups(harness_name: str) -> list:
    """DOC_GROUPS filtered to the active harness: a page with a `harness` tag
    that doesn't match is dropped, a group tag applies to all its pages, and a
    group left empty is removed. Pure; the source registry is never mutated."""
    groups = []
    for g in DOC_GROUPS:
        g_tag = g.get("harness")
        if g_tag and g_tag != harness_name:
            continue
        pages = [p for p in g["pages"]
                 if not p.get("harness") or p["harness"] == harness_name]
        if pages:
            groups.append({**g, "pages": pages})
    return groups


# Match the slug shape the frontend's `slug()` produces, so a DOC_GROUPS
# `anchor` written against a heading matches whatever the renderer assigns.
_SLUG_STRIP_RE = re.compile(r"[^a-z0-9\s-]")
_SLUG_WS_RE = re.compile(r"\s+")
_SLUG_DASH_RE = re.compile(r"-+")
_HEADING_RE = re.compile(r"^(#{1,6})\s+(.+?)\s*$")


def _slugify_heading(text: str) -> str:
    """Same slug rules as web/src/pages/Docs/MarkdownPage.jsx → slug().
    Keeps the server-side anchor match identical to client-side heading ids."""
    s = _SLUG_STRIP_RE.sub("", text.lower().strip())
    s = _SLUG_WS_RE.sub("-", s)
    s = _SLUG_DASH_RE.sub("-", s)
    return s.strip("-")


def _slice_section(body: str, anchor: str) -> "tuple[str, bool]":
    """Trim `body` to just the section whose heading slug matches `anchor` —
    the heading line through the line before the next heading of equal or
    lesser depth. Code fences are tracked so `#` inside ``` blocks is never
    misread as a heading. H1 slices stop at the first H2 so they capture an
    intro paragraph instead of the whole file.

    Returns (body, ok). ok=False (and the original body) when the anchor is
    missing, so the caller falls back to the full document."""
    lines = body.splitlines()
    start = -1
    start_level = 0
    in_fence = False
    for i, ln in enumerate(lines):
        if ln.startswith("```"):
            in_fence = not in_fence
            continue
        if in_fence:
            continue
        m = _HEADING_RE.match(ln)
        if not m:
            continue
        if _slugify_heading(m.group(2)) == anchor:
            start = i
            start_level = max(len(m.group(1)), 2)
            break
    if start < 0:
        return body, False
    out = [lines[start]]
    in_fence = False
    for j in range(start + 1, len(lines)):
        ln = lines[j]
        if ln.startswith("```"):
            in_fence = not in_fence
            out.append(ln)
            continue
        if in_fence:
            out.append(ln)
            continue
        m = _HEADING_RE.match(ln)
        if m and len(m.group(1)) <= start_level:
            break
        out.append(ln)
    while out and out[-1].strip() == "":
        out.pop()
    return "\n".join(out) + "\n", True


def _cli_reference() -> dict:
    """Walk the harness argparser into a JSON-able shape: one entry per
    subcommand, each carrying its help text, positional args, and options.
    The frontend renders each as a card."""
    parser = harness.build_argparser()
    sub_action = next((a for a in parser._actions
                       if isinstance(a, argparse._SubParsersAction)), None)
    if sub_action is None:
        return {"prog": parser.prog, "commands": []}

    def _arg(a) -> dict:
        return {
            "names": list(a.option_strings),
            "dest": a.dest,
            "metavar": a.metavar,
            "help": (a.help or "") if a.help is not argparse.SUPPRESS else "",
            "choices": list(a.choices) if a.choices else None,
            "default": None if a.default is None else
                       (a.default if isinstance(a.default, (str, int, float, bool)) else str(a.default)),
            "required": bool(getattr(a, "required", False)),
            "nargs": str(a.nargs) if a.nargs is not None else None,
            "is_flag": not a.option_strings is None and len(a.option_strings) > 0 and a.nargs == 0,
        }

    commands = []
    for name, sp in sub_action.choices.items():
        positionals, options = [], []
        for a in sp._actions:
            if isinstance(a, argparse._HelpAction):
                continue
            if a.help is argparse.SUPPRESS:
                continue
            (positionals if not a.option_strings else options).append(_arg(a))
        # The help text we attached via sub.add_parser(..., help=...) lives on
        # the subparser action, not on sp itself — read it back from the parent.
        help_text = ""
        for action in sub_action._choices_actions:
            if action.dest == name:
                help_text = action.help or ""
                break
        commands.append({
            "name": name,
            "help": help_text,
            "description": sp.description or "",
            "positionals": positionals,
            "options": options,
        })
    commands.sort(key=lambda c: c["name"])
    return {"prog": parser.prog, "commands": commands}


def _glossary(state: WebState) -> dict:
    """Side-by-side neutral term vs deployed-theme term for the invented
    vocabulary. Reads the neutral + deployed theme JSON to pull the strings the
    build actually substitutes — so a glossary entry can never disagree with
    what the agent prints."""
    def _load(theme: str) -> dict:
        try:
            return json.loads(
                (build.THEMES / f"{theme}.json").read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return {}
    neutral = _load("neutral")
    themed = _load(state.theme) if state.theme != "neutral" else neutral
    rows = []
    for label, key, desc in GLOSSARY_KEYS:
        rows.append({
            "label": label,
            "neutral": str(neutral.get(key, "")).strip(),
            "themed": str(themed.get(key, "")).strip(),
            "desc": desc,
        })
    return {"theme": state.theme, "rows": rows}


def _about(state: WebState) -> dict:
    """About-page payload: version line, deployed install summary, links."""
    sd = harness._status_data()
    return {
        "version": sd.get("version") or {},
        "theme": state.theme,
        "emit": state.emit,
        "deployed": _deployed(state),
        "target": str(state.target),
        "root": str(ROOT),
        "python": sys.version.split()[0],
        "repo": "https://github.com/Arylmera/Geneseed",
        "license": "MIT",
    }


def api_docs(state: WebState, harness_name: "str | None" = None) -> dict:
    """Top-level menu the Docs page renders in its left sub-nav: the concepts,
    references, and the curated DESIGN.md — filtered to the active harness. The
    resolved `harness` is echoed so the client can adopt the installed default
    on first load (empty localStorage)."""
    hn = _norm_harness(harness_name, state)
    groups = [{"id": g["id"], "label": g["label"],
               "pages": [{"id": p["id"], "title": p["title"], "kind": p["kind"]}
                         for p in g["pages"]]}
              for g in _visible_groups(hn)]
    return {"groups": groups, "harness": hn}


def api_docs_page(state: WebState, page_id: str,
                  harness_name: "str | None" = None) -> dict:
    """One docs page, looked up in DOC_GROUPS. Every shape carries a `kind`
    the frontend dispatches on. Markdown/concept bodies are filtered to the
    active harness (inline `<!--harness:X-->` blocks stripped).

    Lookup deliberately ignores the page's `harness` tag: a direct deep-link to a
    page the active harness hides still resolves (the client redirects it out of
    view). The invariant that no *visible* page links to a hidden one is enforced
    by test_no_cross_harness_dead_links, not here."""
    page = _find_doc_page(page_id)
    if not page:
        raise NotFound(page_id)
    hn = _norm_harness(harness_name, state)
    kind = page["kind"]
    if kind == "markdown":
        body = _read_doc_source(page["source"])
        anchor = page.get("anchor")
        # `slice: True` trims the body to just that section — the renderer
        # then shows one focused page instead of dumping the whole source
        # file. When a slice succeeds we drop the anchor so the client doesn't
        # try to scroll to it (the heading is already at the top).
        if anchor and page.get("slice"):
            body, sliced = _slice_section(body, anchor)
            if sliced:
                anchor = None
        body = _strip_harness_blocks(body, hn)
        return {"id": page_id, "title": page["title"], "kind": "markdown",
                "body": body, "source": page["source"],
                "anchor": anchor,
                "links": _resolve_links(state, body)}
    if kind == "concept":
        body = _strip_harness_blocks(page.get("body", ""), hn)
        return {"id": page_id, "title": page["title"], "kind": "concept",
                "body": body, "link": page.get("link"),
                "links": _resolve_links(state, body)}
    if kind == "cli":
        return {"id": page_id, "title": page["title"], "kind": "cli",
                **_cli_reference()}
    if kind == "glossary":
        return {"id": page_id, "title": page["title"], "kind": "glossary",
                **_glossary(state)}
    if kind == "about":
        return {"id": page_id, "title": page["title"], "kind": "about",
                **_about(state)}
    raise NotFound(page_id)

