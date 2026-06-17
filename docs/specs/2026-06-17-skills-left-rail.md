# Spec — Skills in the left rail, grouped by category

**Status:** design confirmed → ready to plan.
**Date:** 2026-06-17

**Decisions (2026-06-17):** mirror the Laws pattern exactly. (1) Categories
stored in a **central `SKILL_CLASS` dict** on the server (not per-file
frontmatter), guarded by a doctor parity gate. (2) New dedicated **Skills page**
with a **filter chip-bar** (not grouped sections). (3) Skills **moved out** of
the generic Library, like Laws — the dedicated page is the single door.

---

## 1. Problem

Skills (37 today, in `src/skills/*.md`) are only browsable inside the generic
**Library** page — a flat, uncategorised list shared with agents/memory/etc.
Laws recently got promoted to their own left-rail entry + dedicated page with a
category chip-bar ([Laws.jsx](../../web/src/pages/Laws.jsx)). We want the same
treatment for Skills: a top-level rail entry, a purpose-built page, and the
skills grouped by a small set of categories you can filter on.

## 2. The Laws pattern we're mirroring

| Concern | Laws implementation |
|---|---|
| Category source | `LAW_CLASS` dict keyed by Roman numeral — [_harness_tui.py:224](../../rituals/_harness_tui.py) |
| Attach to inventory | each law carries `klass` in `_parse_laws` |
| Ship over API | catalog item includes `"klass"` — [_web_catalog.py:130](../../rituals/_web_catalog.py) |
| Rail entry | `#/laws` nav item with count tag — [Rail.jsx:15](../../web/src/components/Rail.jsx) |
| Dedicated page | chip-bar filters one flat list — [Laws.jsx](../../web/src/pages/Laws.jsx) |
| Out of Library | omitted from `SECTION_ORDER` — [sections.js:27](../../web/src/lib/sections.js) |

Categories are **not** in the law source files. The numeral is the join key; the
class lives in one hand-maintained server dict. We do the same: skill **name** is
the join key, class lives in `SKILL_CLASS`.

## 3. Taxonomy (tune before building)

Proposed 6 classes (merged Meta into the others vs the 7-way first cut). This is
the human-judgment part — adjust names/assignments freely.

| Class | key | Skills |
|---|---|---|
| Design | `design` | brainstorm, clarify, plan, council, workflow, parallel-agents |
| Build | `build` | tdd, refactor, debug, migrate, frontend-design |
| Review | `review` | code-review, fresh-eyes, gap-detector, roast-me, review-response |
| Ship | `ship` | commit, ship, release, handoff, git-rescue |
| Understand | `understand` | repo-map, git-archaeology, decode, research, ingest, document-project, wiki, prose |
| Learn | `learn` | crash-course, drill, feynman, learning-path |

Unplaced grab-bag to slot before building: **geneseed, herdr, mcp, ponytail**
(tooling/meta). Either add a 7th `meta` class or fold each into the closest fit
(e.g. mcp→build, ponytail→review, geneseed/herdr→understand).

Each class also needs a chip colour (OKLCH, same scheme as `LAW_CATS`).

## 4. Changes

### Server
1. **`rituals/_harness_tui.py`** — add `SKILL_CLASS: dict[str, str]` (name →
   class key), mirroring `LAW_CLASS`. In `_tui_inventory` (line ~302), add
   `"klass": SKILL_CLASS.get(name, "build")` to the skill `entry`.
2. **`rituals/_web_catalog.py`** — skills branch (line ~135): add `"klass":
   e.get("klass", "build")` to the catalog item. (Agents branch shares this code;
   it just ignores the extra field, or split skills into its own branch — one line
   either way.) Also add `klass` to `api_item` for `type_ == "skill"` so the
   detail view can colour-match.
3. **`rituals/_harness_build.py`** — doctor parity gate. Next to the existing
   AGENT.md-table orphan check (line ~213), assert every skill stem is a key in
   `SKILL_CLASS` and every `SKILL_CLASS` key is a real skill file. Same failure
   shape as `"{folder}/{orphan}.md exists but the AGENT.md table omits it"`. This
   is what keeps the hand-dict from drifting.

### Frontend
4. **`web/src/pages/Skills.jsx`** — new page, trimmed copy of `Laws.jsx`:
   - `SKILL_CATS` (label + OKLCH colour) + `SKILL_CAT_ORDER`.
   - No Roman/Arabic conversion, no "Principle" column — skills are name + desc.
   - Rows show: name, one-line desc (from catalog `desc`), class chip. Expand
     lazy-loads `/api/item/skill/<name>` like `LawRow` does. Deep-link via
     `#/item/skill/<name>` so Spotlight links pre-open a skill.
   - Chip-bar: All + one chip per class with counts; filter the flat list.
5. **`web/src/components/Rail.jsx`** — add a `#/skills` nav item under the
   "Harness" group (after Laws), `icon: 'skill'`, `tag: (o) => o?.counts?.skills`.
   (`counts.skills` already exists in overview — used by Library today.)
6. **`web/src/App.jsx`** — route `#/skills` → `<Skills>`, and make
   `#/item/skill/<name>` open the Skills page with that row selected (mirror how
   Laws handles `selected`).
7. **`web/src/lib/sections.js`** — remove `skills` from `SECTION_ORDER` (keep the
   `SECTIONS.skills` entry so the `skill` item type still resolves, exactly as
   Laws does). Update the leading comment to mention skills alongside laws.
8. **Rebuild the web dist** (`web/dist/`) via the project's build step so the
   server serves the new bundle.

### Reuse note
`Laws.jsx` and `Skills.jsx` will share ~80% structure (chip-bar, expandable
lazy-loaded rows, deep-link selection). Resist extracting a shared component up
front (Law V says reuse, but YAGNI on the abstraction until a 3rd consumer
appears) — copy now, factor later if a third categorised list lands.

## 5. Out of scope
- Per-file frontmatter (rejected: bigger diff, new convention, drift already
  solved by the doctor gate).
- Grouped-section layout (rejected: filter chips match Laws; revisit if the flat
  list feels long).
- TUI changes — this is a web-only promotion. The TUI Library submenu still lists
  skills; leave it. `klass` rides along in the inventory harmlessly.

## 6. Testing
- `_tui_inventory` is unit-tested (pure) — extend its test to assert each skill
  entry has a `klass` and that every class is a known key.
- Doctor parity gate is itself the regression guard for drift; add a test that a
  skill missing from `SKILL_CLASS` makes doctor fail.
- `python rituals/harness.py doctor --all` + `python -m unittest discover -s tests`
  must pass green before ship.
