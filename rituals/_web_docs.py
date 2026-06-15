"""Geneseed web — the Docs/Specs API: doc-page slicing, spec index, CLI
reference, glossary, about.

Part of the web API (see web.py). Imports the shared toolset from _web_core."""
from __future__ import annotations

from _web_core import *  # noqa: F401,F403  shared stdlib + primitives


# ---- Docs API --------------------------------------------------------------

SPEC_DATE_RE = re.compile(r"^(\d{4}-\d{2}-\d{2})-(.+)\.md$")


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


def _spec_purpose(text: str) -> str:
    """First non-heading paragraph of a spec, used as its index blurb. We skip
    the title, the metadata block (Date/Status lines), and any leading blank
    lines, then return the first paragraph trimmed to one line."""
    lines = text.splitlines()
    paras: list[list[str]] = []
    buf: list[str] = []
    for ln in lines:
        s = ln.strip()
        if not s:
            if buf:
                paras.append(buf)
                buf = []
            continue
        if s.startswith("#"):
            if buf:
                paras.append(buf)
                buf = []
            continue
        if s.startswith("**Date:") or s.startswith("**Status:"):
            continue
        buf.append(s)
    if buf:
        paras.append(buf)
    if not paras:
        return ""
    flat = " ".join(paras[0]).strip()
    return (flat[:240] + "…") if len(flat) > 240 else flat


_SPEC_STATUS_RE = re.compile(r"\*\*Status:\*\*\s*(.+?)\s*$", re.MULTILINE)


def _spec_status(body: str) -> str:
    """Normalise a spec's `**Status:** …` line into one of three buckets the
    web Specs list uses for its badge: planned (default), ongoing, completed.

    Recognised phrasings (case-insensitive):
      - completed  ← "implemented", "completed", "done", "shipped", "merged"
      - ongoing    ← "implementing", "in progress", "wip", "ongoing", any
                     arrow chain whose right side names ongoing work
      - planned    ← "draft", "proposed", "approved", "planned", or unknown
    """
    m = _SPEC_STATUS_RE.search(body)
    if not m:
        return "planned"
    raw = m.group(1).lower()
    # Arrow-chained statuses ("approved → implementing") take the rightmost
    # token: that's the current state, not the prior one.
    if "→" in raw or "->" in raw:
        raw = re.split(r"[→]|->", raw)[-1].strip()
    if any(k in raw for k in ("implemented", "completed", "done", "shipped", "merged")):
        return "completed"
    if any(k in raw for k in ("implementing", "in progress", "wip", "ongoing")):
        return "ongoing"
    return "planned"


def _specs_index() -> list[dict]:
    """All `docs/specs/*.md`, sorted newest first, with a date and a one-line
    purpose pulled from the body. The id is `spec:<filename>`."""
    out = []
    specs_dir = ROOT / "docs" / "specs"
    if not specs_dir.is_dir():
        return out
    for p in sorted(specs_dir.glob("*.md")):
        m = SPEC_DATE_RE.match(p.name)
        date = m.group(1) if m else ""
        try:
            body = p.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        title = ""
        for ln in body.splitlines():
            if ln.startswith("# "):
                title = ln[2:].strip()
                break
        out.append({
            "id": f"spec:{p.name}",
            "title": title or p.stem,
            "date": date,
            "filename": p.name,
            "purpose": _spec_purpose(body),
            "status": _spec_status(body),
        })
    out.sort(key=lambda s: s["date"], reverse=True)
    return out


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


def api_docs(state: WebState) -> dict:
    """Top-level menu the Docs page renders in its left sub-nav. Dated specs
    live behind their own rail entry now (api_specs) — Docs only carries the
    concepts, references, and the curated DESIGN.md."""
    groups = [{"id": g["id"], "label": g["label"],
               "pages": [{"id": p["id"], "title": p["title"], "kind": p["kind"]}
                         for p in g["pages"]]}
              for g in DOC_GROUPS]
    return {"groups": groups}


def api_specs(state: WebState) -> dict:
    """The dated implementation specs under docs/specs/, newest first. The
    detail view is served by api_docs_page('spec:<filename>') so the rendering
    pipeline (wikilink resolution, markdown body) stays single-sourced."""
    return {"specs": _specs_index()}


def api_docs_page(state: WebState, page_id: str) -> dict:
    """One docs page. Looks up DOC_GROUPS first; falls back to `spec:<file>`
    for the discovered specs index entries. Every shape carries a `kind` the
    frontend dispatches on."""
    if page_id.startswith("spec:"):
        fname = page_id.split(":", 1)[1]
        if "/" in fname or "\\" in fname or not fname.endswith(".md"):
            raise NotFound(page_id)
        body = _read_doc_source(f"docs/specs/{fname}")
        title = fname
        for ln in body.splitlines():
            if ln.startswith("# "):
                title = ln[2:].strip()
                break
        return {"id": page_id, "title": title, "kind": "markdown",
                "body": body, "source": f"docs/specs/{fname}",
                "links": _resolve_links(state, body)}
    page = _find_doc_page(page_id)
    if not page:
        raise NotFound(page_id)
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
        return {"id": page_id, "title": page["title"], "kind": "markdown",
                "body": body, "source": page["source"],
                "anchor": anchor,
                "links": _resolve_links(state, body)}
    if kind == "concept":
        body = page.get("body", "")
        return {"id": page_id, "title": page["title"], "kind": "concept",
                "body": body, "link": page.get("link"),
                "links": _resolve_links(state, body)}
    if kind == "cli":
        return {"id": page_id, "title": page["title"], "kind": "cli",
                **_cli_reference()}
    if kind == "specs":
        return {"id": page_id, "title": page["title"], "kind": "specs",
                "specs": _specs_index()}
    if kind == "glossary":
        return {"id": page_id, "title": page["title"], "kind": "glossary",
                **_glossary(state)}
    if kind == "about":
        return {"id": page_id, "title": page["title"], "kind": "about",
                **_about(state)}
    raise NotFound(page_id)

