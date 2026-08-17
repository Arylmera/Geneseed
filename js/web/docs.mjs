/**
 * The web console's Docs pages — `rituals/_web_docs.py` and the registry
 * `_web_core.py` builds from `docs/web/`.
 *
 * WHAT CROSSES HERE AND WHAT DOES NOT, measured before the phase was taken rather than
 * discovered inside it. `api_docs_page` dispatches on five KINDS, and 57 of the 59 pages
 * are one of the three that are pure string work: `markdown` (read, slice, strip),
 * `concept` (an inline body with live counts substituted) and `glossary`. Those three
 * crossed in P6d, `about` in P8c (four of five), and `cli` is P10c's. The two deferrals had
 * a reason that is not "it is long":
 *
 *   * `cli` walked `harness.build_argparser()` — **182 lines, 24 subparsers, 43
 *     `add_argument` calls**, every one carrying help text, a metavar, choices and a
 *     default. A Node twin cannot introspect it; reproducing it means transcribing the
 *     whole CLI surface into a second table that would describe verbs `bin/geneseed-cli.mjs`
 *     cannot even run. This port's standing rule is that a copy of a value under test stops
 *     being the value under test, and this would be the largest copy in it. **PAID IN P10c**,
 *     by the fix the deferral named: the parser's metadata became a FILE both implementations
 *     read — `js/cli-table.json` since P2. `js/cli.mjs` is the reader,
 *     `tests/test_cli_reference.py` is what fails when the table and the parser part company
 *     for as long as the parser exists, and `bin/geneseed-cli.mjs`'s `VERBS` table
 *     — which was a SECOND transcription of the same 43 calls — reads it too, so the port
 *     ended with one description of the CLI where it had been heading for three.
 *   * `about` called `_update._origin_display()`, which shells out to `git remote get-url`.
 *     `rituals/_update.py` was P8's whole subject and P6d would have needed an
 *     `_ALLOWED_SPAWNS` row for `git` ahead of the phase that argues for it. **PAID IN P8c**:
 *     P8a made that argument and ported `originDisplay()`, so the deferral was a one-line
 *     removal from `NOT_PORTED_KINDS` and a row in `KIND_ROUTES`.
 *
 * So `NOT_PORTED_KINDS` declares what is left, `api_docs_page` answers 501 for it, and
 * `tests/test_web_server.py` cross-checks that set against the kinds `_web_docs.py`
 * actually dispatches on — the same partition shape the route table took in P6b, which is
 * why it is a table here too and not two `if`s.
 *
 * THE `?harness=` QUERY PARAM LANDS HERE. P6a skipped it deliberately (no caller); it is
 * the Docs selector, and it is the ONLY input to these endpoints that is not the checkout,
 * so it is also the only thing a cell can vary. Every filtering rule below is gated by
 * sending both values over one page.
 */
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';

import { ROOT, THEMES } from '../checkout.mjs';
import { cliReference } from '../cli.mjs';
import { readJsonMaybe, readMaybe } from '../installs.mjs';
import { pyResolve } from '../hosts.mjs';
import { PY_SPACE, normcase, parseJson, pyStripSpace } from '../lib/fs.mjs';
import { statusData } from '../status.mjs';
import { originDisplay } from '../update.mjs';
import { NotFound, deployed, resolveLinks } from './api.mjs';

const isFile = (p) => { try { return statSync(p).isFile(); } catch { return false; } };

const DOC_DIR = path.join(ROOT, 'docs', 'web');

/**
 * `_web_core._doc_frontmatter` — a docs page split into its frontmatter map and its body.
 *
 * Deliberately not YAML: each value is a JSON scalar (or a JSON object for `link`), which
 * covers every key these pages use and parses with the standard library. A value that is
 * not valid JSON is kept as the raw string, which is how `title: Something` works.
 */
export function docFrontmatter(text) {
  const marker = '---\n';
  if (!text.startsWith(marker)) return [{}, text];
  const rest = text.slice(marker.length);
  const at = rest.indexOf(marker);
  if (at < 0) return [{}, text];
  const head = rest.slice(0, at);
  const body = rest.slice(at + marker.length);
  const meta = {};
  for (const line of head.split('\n')) {
    const colon = line.indexOf(':');
    const key = (colon < 0 ? line : line.slice(0, colon)).trim();
    const raw = (colon < 0 ? '' : line.slice(colon + 1)).trim();
    if (!key || !raw) continue;
    // `json.loads` first, the raw string on a decode error — and `parseJson`, so a
    // frontmatter number keeps the int/float distinction the rest of this port protects.
    try { meta[key] = parseJson(raw); } catch { meta[key] = raw; }
  }
  return [meta, body];
}

/**
 * `_web_core._load_doc_groups` — the Docs registry, built from `docs/web/`.
 *
 * A page whose file is missing or malformed is skipped rather than crashing the server; an
 * unreadable registry yields an empty Docs section, which the UI renders as "no pages".
 *
 * NOT cached at module load, where the Python builds `DOC_GROUPS` once at import. The
 * difference is invisible to a request — `docs/web/` cannot change under a running daemon
 * any more than `dist/` can — and a module-level constant would freeze whatever `ROOT` was
 * when the corpus first imported this file.
 */
export function docGroups() {
  const groups = readJsonMaybe(path.join(DOC_DIR, '_groups.json'));
  if (!Array.isArray(groups)) return [];
  const byId = new Map();
  for (const g of groups) byId.set(g.id, { ...g, pages: [] });
  let names;
  try { names = readdirSync(DOC_DIR); } catch { return []; }
  for (const name of names.filter((n) => normcase(n).endsWith('.md')).sort()) {
    const text = readMaybe(path.join(DOC_DIR, name));
    if (text === null) continue;
    const [meta, body] = docFrontmatter(text);
    const group = byId.get(meta.group);
    delete meta.group;
    if (group === undefined) continue;
    const order = Object.hasOwn(meta, 'order') ? meta.order : 0;
    delete meta.order;
    const page = { id: name.slice(0, -3), ...meta };
    if (body.trim()) page.body = body.replace(/\n+$/, '');
    group.pages.push([order, page]);
  }
  const out = [];
  for (const g of groups) {
    const entry = byId.get(g.id);
    // `sorted(key=lambda t: t[0])` is STABLE, so equal orders keep filename order.
    entry.pages = entry.pages
      .map((pair, i) => [pair[0], i, pair[1]])
      .sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]))
      .map((t) => t[2]);
    out.push(entry);
  }
  return out;
}

/**
 * `_web_core.GLOSSARY_KEYS` — the neutral term, the theme key whose value renames it, and
 * the one-line description. A key of `null` marks a term no theme renames.
 */
const GLOSSARY_KEYS = [
  ['Rule (Law)', 'LAW', 'the governance rules the agent obeys'],
  ['Rules (Laws)', 'LAWS', 'the body of governance rules'],
  ['Agent', 'AGENT', 'a capability specialist'],
  ['Agents', 'AGENTS', 'the roster of specialists'],
  ['Skill', 'SKILL', 'a repeatable workflow'],
  ['Skills', 'SKILLS', 'the catalogue of workflows'],
  ['Memory', 'MEMORY', 'durable, one-fact-per-file knowledge'],
  ['Notebook', 'NOTEBOOK', "the agent's sovereign space"],
  ['Wiki', 'WIKI', 'the machine-wide knowledge base'],
  ['Pact', 'PACT', 'the two-way collaboration contract'],
  ['Posture', null, 'the relationship register the agent works in '
    + '(peer, mentor, expert, assistant, artisan)'],
  ['Mode', null, 'how work gets executed — direct (the agent works every '
    + 'task itself) or foreman (substantial tasks spawn an isolated pipeline)'],
  ['Footprint', null, 'how much of the Rules loads inline each turn '
    + '(full vs lean)'],
  ['Profile', null, 'who you are — seeded once, colours but never binds'],
  ['Memory force', null, "a memory's binding strength (constraint, "
    + 'choice, conviction, tempered)'],
  ['Tagline', 'TAGLINE', 'the one-line essence of the theme'],
  ['Loaded sigil', 'LOADED_SIGIL', 'what the agent emits when ready'],
  ['Benediction', 'BENEDICTION', 'the closing line of an install'],
];

// ---- counts substituted into concept bodies -------------------------------------------

/** `_web_docs._doc_counts`. */
function docCounts(state) {
  const inv = state.inventory;
  const plugins = path.join(ROOT, 'adapters', 'opencode', 'plugins');
  let n = 0;
  try {
    n = readdirSync(plugins).filter((f) => f.startsWith('geneseed-') && f.endsWith('.js'))
      .length;
  } catch { n = 0; }
  return {
    '{N_LAWS}': (inv.laws || []).length,
    '{N_AGENTS}': (inv.agents || []).length,
    '{N_SKILLS}': (inv.skills || []).length,
    '{N_PLUGINS}': n,
  };
}

/** `_web_docs._sub_counts`. */
function subCounts(state, body) {
  if (!body.includes('{N_')) return body;
  let out = body;
  for (const [token, n] of Object.entries(docCounts(state))) {
    out = out.split(token).join(String(n));
  }
  return out;
}

// ---- harness filtering -----------------------------------------------------------------

const HARNESSES = ['opencode', 'claude'];
const HARNESS_OPEN_RE = /^\s*<!--\s*harness:(opencode|claude)\s*-->\s*$/;
const HARNESS_CLOSE_RE = /^\s*<!--\s*\/harness\s*-->\s*$/;
/**
 * The cheap presence test for the early-out. It must never be NARROWER than the open
 * pattern above — a stray-spaced marker would then slip the guard and leak unstripped —
 * which is why it allows the same `\s*` after `<!--`.
 */
const HARNESS_HINT_RE = /<!--\s*harness:/;

/** `_web_docs._norm_harness`. */
export function normHarness(value, state) {
  const v = (value || '').trim().toLowerCase();
  if (HARNESSES.includes(v)) return v;
  return String(state.emit || '').startsWith('claude') ? 'claude' : 'opencode';
}

/**
 * `_web_docs._harness_blocks_balanced` — every open has a matching close, with no nesting.
 *
 * A marker inside a ``` fence is example text, not a marker (the same rule `sliceSection`
 * uses). Its purpose is to FAIL OPEN: an unbalanced marker leaves the body untouched, so a
 * typo can never blank the rest of a page.
 *
 * EXPORTED FOR THE AUTHORING GATE, in the shape `installAgentEntryOf` established: failing
 * open means a typo is INVISIBLE in the rendered output — the page simply shows everything,
 * which is also what a correct page with no markers does. The only way to catch it is to ask
 * the predicate directly, so `tests/unit/web_api.test.mjs` walks every doc source through it.
 */
export function harnessBlocksBalanced(lines) {
  let open = false;
  let inFence = false;
  for (const line of lines) {
    if (line.startsWith('```')) { inFence = !inFence; continue; }
    if (inFence) continue;
    if (HARNESS_OPEN_RE.test(line)) {
      if (open) return false;
      open = true;
    } else if (HARNESS_CLOSE_RE.test(line)) {
      if (!open) return false;
      open = false;
    }
  }
  return !open;
}

/** `_web_docs._strip_harness_blocks`. */
export function stripHarnessBlocks(body, harnessName) {
  if (!HARNESS_HINT_RE.test(body)) return body;
  const lines = pySplitlines(body);
  if (!harnessBlocksBalanced(lines)) return body;
  const out = [];
  let keep = true;
  let inFence = false;
  for (const line of lines) {
    if (line.startsWith('```')) {
      inFence = !inFence;
      if (keep) out.push(line);
      continue;
    }
    if (!inFence) {
      const m = HARNESS_OPEN_RE.exec(line);
      if (m) { keep = m[1] === harnessName; continue; }
      if (HARNESS_CLOSE_RE.test(line)) { keep = true; continue; }
    }
    if (keep) out.push(line);
  }
  return out.join('\n');
}

/**
 * `str.splitlines()` — which is NOT `split('\n')`: it drops a single trailing newline
 * instead of yielding a final empty string, and that difference reaches the output here
 * because the result is re-joined with `\n`.
 */
function pySplitlines(s) {
  const parts = s.split('\n');
  if (parts.length && parts[parts.length - 1] === '') parts.pop();
  return parts;
}

/** `_web_docs._visible_groups` — pure; the registry is never mutated. */
function visibleGroups(harnessName) {
  const groups = [];
  for (const g of docGroups()) {
    if (g.harness && g.harness !== harnessName) continue;
    const pages = g.pages.filter((p) => !p.harness || p.harness === harnessName);
    if (pages.length) groups.push({ ...g, pages });
  }
  return groups;
}

// ---- slugs and section slicing ----------------------------------------------------------

const SLUG_STRIP_RE = new RegExp(`[^a-z0-9${PY_SPACE}-]`, 'g');
const SLUG_WS_RE = new RegExp(`[${PY_SPACE}]+`, 'g');
const SLUG_DASH_RE = /-+/g;
const HEADING_RE = /^(#{1,6})\s+(.+?)\s*$/;

/**
 * `_web_docs._slugify_heading` — the same rules the frontend's `slug()` uses, so a
 * registry `anchor` written against a heading matches the id the renderer assigns.
 *
 * `PY_SPACE` and `pyStripSpace` rather than `\s` and `trim()`, and the corpus in
 * `tests/test_pure_function_parity.py` is what made that necessary rather than tidy: the
 * two languages' whitespace classes differ at U+FEFF and at U+001C-U+001F, and a heading
 * carrying one slugs differently on each side. See `PY_SPACE`'s docblock for the measured
 * set.
 */
export function slugifyHeading(text) {
  let s = pyStripSpace(text.toLowerCase()).replace(SLUG_STRIP_RE, '');
  s = s.replace(SLUG_WS_RE, '-').replace(SLUG_DASH_RE, '-');
  return s.replace(/^-+|-+$/g, '');
}

/**
 * `_web_docs._slice_section` — the body trimmed to one heading's section.
 *
 * Returns `[body, ok]`; `ok === false` (with the ORIGINAL body) when the anchor is
 * missing, so the caller falls back to the whole document. An H1 slice stops at the first
 * H2 — `max(level, 2)` — so it captures an intro paragraph rather than the whole file.
 */
export function sliceSection(body, anchor) {
  const lines = pySplitlines(body);
  let start = -1;
  let startLevel = 0;
  let inFence = false;
  for (let i = 0; i < lines.length; i += 1) {
    const ln = lines[i];
    if (ln.startsWith('```')) { inFence = !inFence; continue; }
    if (inFence) continue;
    const m = HEADING_RE.exec(ln);
    if (!m) continue;
    if (slugifyHeading(m[2]) === anchor) {
      start = i;
      startLevel = Math.max(m[1].length, 2);
      break;
    }
  }
  if (start < 0) return [body, false];
  const out = [lines[start]];
  inFence = false;
  for (let j = start + 1; j < lines.length; j += 1) {
    const ln = lines[j];
    if (ln.startsWith('```')) { inFence = !inFence; out.push(ln); continue; }
    if (inFence) { out.push(ln); continue; }
    const m = HEADING_RE.exec(ln);
    if (m && m[1].length <= startLevel) break;
    out.push(ln);
  }
  while (out.length && out[out.length - 1].trim() === '') out.pop();
  return [`${out.join('\n')}\n`, true];
}

// ---- the endpoints -----------------------------------------------------------------------

/** `_web_docs._find_doc_page`. */
function findDocPage(pageId) {
  for (const g of docGroups()) {
    for (const p of g.pages) if (p.id === pageId) return p;
  }
  return null;
}

/**
 * `_web_docs._read_doc_source` — a markdown file relative to ROOT, guarded against escapes
 * the same way the catalog is. A GET carries no token, so `rel` comes out of the registry
 * but the guard is what makes that safe to say.
 */
function readDocSource(rel) {
  const target = pyResolve(path.join(ROOT, rel));
  if (!within(target, ROOT) || !isFile(target)) throw new NotFound(rel);
  return readMaybe(target) ?? '';
}

function within(child, parent) {
  const c = normcase(child).split(/[\\/]/);
  const p = normcase(parent).split(/[\\/]/);
  return p.length <= c.length && p.every((seg, i) => c[i] === seg);
}

/** `_web_docs._glossary` — the deployed theme's words beside the neutral ones. */
function glossary(state) {
  const load = (theme) => {
    const doc = readJsonMaybe(path.join(THEMES, `${theme}.json`));
    return doc && typeof doc === 'object' && !Array.isArray(doc) ? doc : {};
  };
  const neutral = load('neutral');
  const themed = state.theme !== 'neutral' ? load(state.theme) : neutral;
  const rows = [];
  for (const [label, key, desc] of GLOSSARY_KEYS) {
    if (key === null) {
      const term = label.toLowerCase();
      rows.push({ label, neutral: term, themed: term, desc });
      continue;
    }
    rows.push({
      label,
      neutral: String(Object.hasOwn(neutral, key) ? neutral[key] : '').trim(),
      themed: String(Object.hasOwn(themed, key) ? themed[key] : '').trim(),
      desc,
    });
  }
  return { theme: state.theme, rows };
}

/**
 * `_web_docs._about` — the About page: a version line, the deployed install, and the links.
 *
 * `repo` is the install's OWN git origin (where updates come from), and `repo_is_github` is
 * what gates the github-shaped deep links in the UI. Both come from `originDisplay()`, which
 * is the one thing P6d could not have: it shells `git remote get-url`, and P8a is the phase
 * that argued for the `git` row in `_ALLOWED_SPAWNS`.
 *
 * `version` IS NOT WHAT IT LOOKS LIKE, and it is the shape this page has always had rather than
 * a shortcut here. It reads a `version` key off the status snapshot and THERE IS NO SUCH KEY —
 * the snapshot spells the fingerprints `source_fp` / `installed_fp` / `version_verdict`. So the
 * field is `{}`, always, and `sd.version || {}` reproduces the EXPRESSION rather than the
 * constant: if the key ever appears, the page gains it without another edit.
 *
 * THERE IS NO INTERPRETER FIELD, and the absence is deliberate — see `apiSetup`, which spells
 * the same absence for the same reason.
 *
 * `statusData()` is called for one dead field, and deliberately: this page has always paid that
 * cost, and skipping it would answer faster in a way no gate measures and no user asked for.
 */
function about(state) {
  const sd = statusData();
  const od = originDisplay();
  return {
    version: sd.version || {},
    theme: state.theme,
    emit: state.emit,
    deployed: deployed(state),
    target: String(state.target),
    root: String(ROOT),
    repo: od.url,
    // `githubSlug`, not `github_slug`. `OriginDisplay`'s JS twin keeps the Python field in
    // camelCase the way every other ported record does, and the RESPONSE key is snake_case
    // because it is the wire format — the two spellings meet exactly here. Reading the wire
    // name off the record gives `undefined`, which is a perfectly plausible `false`: the About
    // page silently drops every github deep link and nothing else changes. Caught by comparing
    // the two payloads by hand before a cell existed; `docs/the-about-page-...` is the cell.
    repo_is_github: Boolean(od.githubSlug),
    license: 'MIT',
  };
}

/**
 * EMPTY SINCE P10c, AND KEPT DECLARED — the third partition in this port to reach that state,
 * after `NOT_PORTED_POST` and `NOT_PORTED_ACTIONS`.
 *
 * `tests/test_web_server.py` cross-checks this set against the kinds
 * `_web_docs.api_docs_page` dispatches on by `ast`, and that check is at its STRONGEST when
 * the set is empty: it then says every kind the reference dispatches on is answered here. A
 * sixth kind added to the reference still cannot quietly fall through to the `NotFound` at
 * the bottom, and the next unported kind has a place to be declared rather than reading as a
 * typo'd page id.
 *
 * WHAT DIED WITH THE LAST ROW is the 501 arm's only reachable target. `test_web_server.py`'s
 * running probe used to GET `/api/docs/page/cli` and require 501; with the set empty no page
 * has an unported kind and none can be borrowed. That probe is now the positive control for
 * `cli` (200), and the claim that the 501 arm still works rests on the declaration check
 * alone — strictly weaker, discipline #7, and said out loud there as it is here.
 *
 * `about` left in P8c (`_origin_display` and the `git` spawn behind it, not the page).
 * `cli` left in P10c, and its blocker was neither: it was that `harness.build_argparser()`
 * cannot be introspected from Node at all. See `js/cli.mjs`.
 */
export const NOT_PORTED_KINDS = new Set();

/** `_web_docs.api_docs`. */
export function apiDocs(state, harnessName = null) {
  const hn = normHarness(harnessName, state);
  const groups = visibleGroups(hn).map((g) => ({
    id: g.id,
    label: g.label,
    pages: g.pages.map((p) => ({ id: p.id, title: p.title, kind: p.kind })),
  }));
  return { groups, harness: hn };
}

/**
 * `_web_docs.api_docs_page`.
 *
 * The lookup deliberately ignores a page's own `harness` tag: a deep link to a page the
 * active harness hides still resolves, and the client redirects it out of view.
 */
export function apiDocsPage(state, pageId, harnessName = null) {
  const page = findDocPage(pageId);
  if (!page) throw new NotFound(pageId);
  const hn = normHarness(harnessName, state);
  const render = KIND_ROUTES[page.kind];
  if (render !== undefined) return render(state, pageId, page, hn);
  if (NOT_PORTED_KINDS.has(page.kind)) {
    const e = new Error(`not ported yet: docs kind '${page.kind}'`);
    e.notPorted = true;
    throw e;
  }
  throw new NotFound(pageId);
}

/**
 * The three kinds that cross, as a TABLE and not three `if`s.
 *
 * `tests/test_web_server.py` requires `Object.keys(KIND_ROUTES) ∪ NOT_PORTED_KINDS` to
 * equal the kinds `_web_docs.api_docs_page` dispatches on, and M23 is why that reads the
 * table the dispatcher actually consults rather than a list beside it: a gate on a
 * declaration cannot see a dispatcher that stopped using it.
 */
const KIND_ROUTES = {
  markdown: (state, pageId, page, hn) => {
    let body = readDocSource(page.source);
    let anchor = page.anchor ?? null;
    // A successful slice drops the anchor: the heading is already at the top, so the
    // client must not also try to scroll to it.
    if (anchor && page.slice) {
      const [sliced, ok] = sliceSection(body, anchor);
      body = sliced;
      if (ok) anchor = null;
    }
    body = stripHarnessBlocks(body, hn);
    return { id: pageId, title: page.title, kind: 'markdown', body,
      source: page.source, anchor, links: resolveLinks(state, body) };
  },
  concept: (state, pageId, page, hn) => {
    const body = subCounts(state, stripHarnessBlocks(page.body ?? '', hn));
    return { id: pageId, title: page.title, kind: 'concept', body,
      link: page.link ?? null, links: resolveLinks(state, body) };
  },
  glossary: (state, pageId, page) => ({
    id: pageId, title: page.title, kind: 'glossary', ...glossary(state),
  }),
  about: (state, pageId, page) => ({
    id: pageId, title: page.title, kind: 'about', ...about(state),
  }),
  // P6d's deferral, paid in P10c. The row is one line because the work was not in the page:
  // it was in making `harness.build_argparser()`'s metadata a file both implementations read.
  cli: (state, pageId, page) => ({
    id: pageId, title: page.title, kind: 'cli', ...cliReference(),
  }),
};

export const PORTED_KINDS = Object.keys(KIND_ROUTES);
