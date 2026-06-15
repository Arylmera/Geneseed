"""Geneseed web — capability graph and the offline-bundle zip.

Part of the web API (see web.py). Imports the shared toolset from _web_core."""
from __future__ import annotations

from _web_core import *  # noqa: F401,F403  shared stdlib + primitives


def _law_ref_re(theme: dict) -> "re.Pattern[str]":
    """Regex matching a plain-text law reference like "Rule III" / "Dictate III".

    The law-noun is themed: the source files write `{{LAW}} N`, so the rendered
    body uses whatever the active theme calls a law ("Rule", "Dictate", "Code",
    "Directive", …). A hardcoded `Rule|Law` only matched the neutral theme and
    silently dropped every law edge under any other theme — which is why the
    graph showed no links. Build the alternation from the theme's LAW/LAWS
    tokens (plus the canonical Rule/Law as a fallback for un-themed prose)."""
    words = {"Rule", "Law", str(theme.get("LAW", "")), str(theme.get("LAWS", ""))}
    alt = "|".join(re.escape(w) for w in sorted(words, key=len, reverse=True) if w)
    return re.compile(rf"\b(?:{alt})\s+([IVXLCDM]+)\b", re.IGNORECASE)


def api_graph(state: WebState) -> dict:
    """Cross-link graph over agents + skills + laws: one node per item, one edge
    per [[wikilink]] (agents/skills) or per `Rule N` / `Law N` plain-text reference
    (any entity → laws). Laws have no wikilink target since their id is a Roman
    numeral; the prose pattern catches both law↔law cross-references and any
    agent/skill that names a rule by number."""
    inv = state.inventory
    law_ref_re = _law_ref_re(build.load_theme(state.theme))
    known = {}
    for e in inv["agents"]:
        known[e["name"]] = "agent"
    for e in inv["skills"]:
        known[e["name"]] = "skill"
    law_nums = set()
    for e in inv["laws"]:
        known[e["num"]] = "law"
        law_nums.add(e["num"])
    nodes = [{"id": name, "type": type_} for name, type_ in sorted(known.items())]
    edges, seen = [], set()

    def add_edge(src: str, dst: str) -> None:
        if dst != src and (src, dst) not in seen:
            seen.add((src, dst))
            edges.append({"source": src, "target": dst})

    for kind in ("agents", "skills"):
        for e in inv[kind]:
            src = e["name"]
            for m in WIKILINK_RE.finditer(e["body"]):
                dst = m.group(1).strip()
                if dst in known and known[dst] != "law":
                    add_edge(src, dst)
            for m in law_ref_re.finditer(e["body"]):
                if m.group(1) in law_nums:
                    add_edge(src, m.group(1))
    for e in inv["laws"]:
        src = e["num"]
        for m in law_ref_re.finditer(e["body"]):
            if m.group(1) in law_nums:
                add_edge(src, m.group(1))
    return {"nodes": nodes, "edges": edges}


OFFLINE_ZIP_SKIP = {".git", "node_modules", "__pycache__", ".superpowers"}


def offline_zip_bytes() -> "tuple[bytes, str]":
    """(zip bytes, download name) of the source tree — the sneakernet package a
    proxied/offline machine consumes with `geneseed upgrade --zip <file>`.
    `git archive` (tracked files only) when git is available; otherwise a
    zipfile walk skipping VCS/build litter. The geneseed-offline/ prefix matches
    what the consume side expects (a geneseed-* wrapper dir, like GitHub zips)."""
    name = f"geneseed-offline-{time.strftime('%Y%m%d')}.zip"
    try:
        p = subprocess.run(
            ["git", "archive", "--format=zip", "--prefix=geneseed-offline/", "HEAD"],
            cwd=str(ROOT), capture_output=True, timeout=60)
        if p.returncode == 0 and p.stdout:
            return p.stdout, name
    except (OSError, subprocess.TimeoutExpired):
        pass
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for f in sorted(ROOT.rglob("*")):
            rel = f.relative_to(ROOT)
            if f.is_file() and not (set(rel.parts) & OFFLINE_ZIP_SKIP):
                zf.write(f, f"geneseed-offline/{rel.as_posix()}")
    return buf.getvalue(), name


