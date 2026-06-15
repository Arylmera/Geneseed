"""Geneseed web — catalog & item reads (agents/skills/laws/memory/notebook/wiki/config).

Part of the web API (see web.py). Imports the shared toolset from _web_core;
cross-submodule names are linked at import time by web.py."""
from __future__ import annotations

from _web_core import *  # noqa: F401,F403  shared stdlib + primitives


def _memory_items(state: WebState) -> list[dict]:
    d = harness._resolve_memory_dir(None)
    if not d or not d.is_dir():
        return []
    out = []
    for p in sorted(d.glob("*.md")):
        fm, _body = harness._frontmatter(p.read_text(encoding="utf-8", errors="replace"))
        out.append({"name": p.stem,
                    "title": fm.get("name", p.stem),
                    "desc": fm.get("description", ""),
                    "source": str(p.resolve())})
    return out


def _notebook_dir(state: WebState) -> Path:
    return state.target / "notebook"


def _notebook_items(state: WebState) -> list[dict]:
    d = _notebook_dir(state)
    if not d.is_dir():
        return []
    return [{"name": p.stem, "title": p.stem, "desc": "",
             "source": str(p.resolve())}
            for p in sorted(d.glob("*.md"))]


WIKI_FILE_CAP = 300  # per manifest entry — a vault folder can be huge


def _wiki_manifest(state: WebState) -> list:
    """The wiki manifest's `wikis` list, resolved like the context plugin does:
    $GENESEED_WIKI first, else wiki.jsonc beside the deployed bundle."""
    import os
    cand = os.environ.get("GENESEED_WIKI")
    p = Path(cand).expanduser() if cand else state.target / "wiki.jsonc"
    if not p.is_file():
        return []
    cfg = harness._mcp_load(p)   # the harness's generic JSONC dict loader
    wikis = cfg.get("wikis")
    return wikis if isinstance(wikis, list) else []


def _wiki_items(state: WebState) -> list[dict]:
    """Browsable wiki pages: every .md under each manifest entry (folders walked
    recursively, capped), minus the entries marked load=exclude. Item names are
    '<wiki>:<relpath>' so api_item can resolve them back to the right vault."""
    items, seen = [], set()
    for w in _wiki_manifest(state):
        if not isinstance(w, dict):
            continue
        wname = str(w.get("name") or "wiki")
        root = Path(str(w.get("path") or "")).expanduser()
        if not root.is_dir():
            continue
        entries = [e for e in (w.get("entries") or []) if isinstance(e, dict)]
        excludes = [str(e.get("path") or "").strip("/").replace("\\", "/")
                    for e in entries if e.get("load") == "exclude"]

        def excluded(rel: str) -> bool:
            return any(rel == x or rel.startswith(x + "/") for x in excludes if x)

        for e in entries:
            if e.get("load") == "exclude":
                continue
            rel = str(e.get("path") or "").strip("/").replace("\\", "/")
            desc = str(e.get("description") or "")
            fp = root / rel
            if fp.is_file() and fp.suffix == ".md":
                mds = [fp]
            elif fp.is_dir():
                mds = sorted(fp.rglob("*.md"))[:WIKI_FILE_CAP]
            else:
                continue
            for md in mds:
                r = md.relative_to(root).as_posix()
                key = f"{wname}:{r}"
                if key in seen or excluded(r):
                    continue
                seen.add(key)
                items.append({"name": key, "title": md.stem,
                              "desc": desc if len(mds) == 1 else r})
    return items


def api_wiki_item(state: WebState, name: str) -> dict:
    """One wiki page by '<wiki>:<relpath>' — read from the vault, never outside it."""
    wname, _, rel = name.partition(":")
    rel = rel.strip("/").replace("\\", "/")
    for w in _wiki_manifest(state):
        if isinstance(w, dict) and str(w.get("name") or "wiki") == wname:
            root = Path(str(w.get("path") or "")).expanduser().resolve()
            p = (root / rel).resolve()
            if rel and p.suffix == ".md" and harness._within(p, root) and p.is_file():
                body = p.read_text(encoding="utf-8", errors="replace")
                return {"type": "wiki", "name": name, "title": p.stem, "desc": "",
                        "body": body, "links": _resolve_links(state, body)}
    raise NotFound(name)


def _config_items(state: WebState) -> list[dict]:
    out = []
    for fname in ("context.json", "wiki.jsonc"):
        p = state.target / fname
        if p.is_file():
            out.append({"name": fname, "title": fname, "desc": "",
                        "source": str(p.resolve())})
    return out


def api_catalog(state: WebState, section: str) -> dict:
    if section not in SECTIONS:
        raise NotFound(section)
    inv = state.inventory
    if section in ("agents", "skills"):
        items = [{"name": e["name"], "title": e["name"], "desc": e["desc"],
                  "source": e.get("source")}
                 for e in inv[section]]
    elif section == "laws":
        items = [{"name": e["num"], "title": f"Rule {e['num']} — {e['title']}",
                  "desc": "", "klass": e.get("klass", "craft")}
                 for e in inv["laws"]]
    elif section == "memory":
        items = _memory_items(state)
    elif section == "notebook":
        items = _notebook_items(state)
    elif section == "wiki":
        items = _wiki_items(state)
    else:  # config
        items = _config_items(state)
    return {"section": section, "items": items}


def _resolve_links(state: WebState, body: str) -> list[dict]:
    """Cross-references found in body, resolved to nav targets. Matches [[name]]
    wikilinks against known agent/skill names."""
    inv = state.inventory
    known = {}  # name -> "agent" | "skill"
    for e in inv["agents"]:
        known[e["name"]] = "agent"
    for e in inv["skills"]:
        known[e["name"]] = "skill"
    links, seen = [], set()
    for m in WIKILINK_RE.finditer(body):
        label = m.group(1).strip()
        if label in known and label not in seen:
            seen.add(label)
            links.append({"label": label, "type": known[label], "name": label})
    return links


def api_item(state: WebState, type_: str, name: str) -> dict:
    inv = state.inventory
    if type_ == "agent":
        e = next((x for x in inv["agents"] if x["name"] == name), None)
        if not e:
            raise NotFound(name)
        return {"type": type_, "name": name, "title": name, "desc": e["desc"],
                "body": e["body"], "links": _resolve_links(state, e["body"]),
                "source": e.get("source")}
    if type_ == "skill":
        e = next((x for x in inv["skills"] if x["name"] == name), None)
        if not e:
            raise NotFound(name)
        return {"type": type_, "name": name, "title": name, "desc": e["desc"],
                "body": e["body"], "links": _resolve_links(state, e["body"]),
                "source": e.get("source")}
    if type_ == "law":
        e = next((x for x in inv["laws"] if x["num"] == name), None)
        if not e:
            raise NotFound(name)
        return {"type": type_, "name": name, "title": f"Rule {e['num']} — {e['title']}",
                "desc": "", "body": e["body"], "links": [],
                "klass": e.get("klass", "craft")}
    if type_ in ("memory", "notebook"):
        d = _notebook_dir(state) if type_ == "notebook" \
            else harness._resolve_memory_dir(None)
        p = (d / f"{name}.md") if d else None
        if not p or not p.is_file():
            raise NotFound(name)
        body = p.read_text(encoding="utf-8", errors="replace")
        return {"type": type_, "name": name, "title": name, "desc": "",
                "body": body, "links": _resolve_links(state, body),
                "source": str(p.resolve())}
    if type_ == "wiki":
        return api_wiki_item(state, name)
    if type_ == "config":
        p = state.target / name
        if not p.is_file():
            raise NotFound(name)
        raw = p.read_text(encoding="utf-8", errors="replace")
        return {"type": type_, "name": name, "title": name, "desc": "",
                "body": f"```json\n{raw}\n```", "links": [],
                "source": str(p.resolve())}
    raise NotFound(type_)

