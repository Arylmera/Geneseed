/**
 * The web console's Docs pages, and the registry built from `docs/<folder>/` (DOC_FOLDERS).
 *
 * `cli` docs render via `cliReference()` in `js/ui/cli.mjs`, which reads
 * `js/cli-table.json` — the CLI's own metadata, since `harness.build_argparser()`'s parser
 * is not something a Node twin can introspect. `bin/geneseed-cli.mjs`'s `VERBS` table reads
 * the same file, so there is exactly one description of the CLI surface, not a second
 * transcription of it.
 *
 * `tests/unit/web_server.test.mjs` holds `KINDS` against a written-out list of the six
 * kinds this daemon dispatches on — same declaration-vs-dispatch shape as the route table,
 * which is why it is a table here too and not six `if`s.
 *
 * THE `?harness=` QUERY PARAM IS the Docs selector, and it is the ONLY input to these
 * endpoints that is not the checkout itself — the one thing a test can vary. Every
 * filtering rule below is exercised by sending each host over one page.
 */
import { readdirSync } from 'node:fs';
import path from 'node:path';

import { DOCS, DOC_FOLDERS, ROOT, THEMES } from '../build/source.mjs';
import { cliReference } from '../ui/cli.mjs';
import { readJsonMaybe, readMaybe } from '../hosts/installs.mjs';
import { resolvePath } from '../hosts/hosts.mjs';
import { parseJson } from '../lib/json.mjs';
import { isFile } from '../lib/fs.mjs';
import { normcase, within } from '../lib/paths.mjs';
import { WHITESPACE, stripWhitespace } from '../lib/text.mjs';
import { statusData } from '../inspect/status.mjs';
import { originDisplay } from '../maintain/update.mjs';
import { NotFound, deployed, resolveLinks } from './api.mjs';

/**
 * A docs page split into its frontmatter map and its body.
 *
 * Deliberately not YAML: each value is a JSON scalar (or a JSON object for `link`), which
 * covers every key these pages use and parses with the standard library. A value that is
 * not valid JSON is kept as the raw string, which is how `title: Something` works.
 */
function docFrontmatter(text) {
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
    // `parseJson`, so a frontmatter number keeps the int/float distinction the rest of
    // this codebase protects.
    try { meta[key] = parseJson(raw); } catch { meta[key] = raw; }
  }
  return [meta, body];
}

/**
 * Every docs page source as `{ id, rel }`, `rel` relative to ROOT with forward slashes.
 *
 * The id is the basename because it is the router's address (`#/docs/<id>`); the folder is
 * GitHub's business, not the console's. Two pages with one basename would leave one of them
 * unreachable, so a duplicate throws instead of shadowing.
 */
export function docSources(docRoot = DOCS) {
  const out = [];
  const seen = new Set();
  for (const folder of DOC_FOLDERS) {
    let names;
    try { names = readdirSync(path.join(docRoot, folder)); } catch { continue; }
    for (const name of names.filter((n) => normcase(n).endsWith('.md')).sort()) {
      const id = name.slice(0, -3);
      if (seen.has(id)) throw new Error(`duplicate docs page id: ${id}`);
      seen.add(id);
      out.push({ id, rel: `docs/${folder}/${name}` });
    }
  }
  return out;
}

/**
 * The Docs registry, built from `docSources()` and `docs/_groups.json`.
 *
 * A page whose file is missing or malformed is skipped rather than crashing the server; an
 * unreadable registry yields an empty Docs section, which the UI renders as "no pages".
 *
 * NOT cached at module load. The difference is invisible to a request — the docs tree cannot
 * change under a running daemon any more than `dist/` can — and a module-level constant
 * would freeze whatever `ROOT` was when this file was first imported.
 */
export function docGroups() {
  const groups = readJsonMaybe(path.join(DOCS, '_groups.json'));
  if (!Array.isArray(groups)) return [];
  const byId = new Map();
  for (const g of groups) byId.set(g.id, { ...g, pages: [] });
  for (const { id, rel } of docSources()) {
    const text = readMaybe(path.join(ROOT, rel));
    if (text === null) continue;
    const [meta, body] = docFrontmatter(text);
    const group = byId.get(meta.group);
    delete meta.group;
    if (group === undefined) continue;
    const order = Object.hasOwn(meta, 'order') ? meta.order : 0;
    delete meta.order;
    const page = { id, rel, ...meta, section: sectionOf(meta) };
    if (body.trim()) page.body = body.replace(/\n+$/, '');
    group.pages.push([order, page]);
  }
  const out = [];
  for (const g of groups) {
    const entry = byId.get(g.id);
    // STABLE sort: equal orders keep filename order.
    entry.pages = bySection(entry.pages
      .map((pair, i) => [pair[0], i, pair[1]])
      .sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]))
      .map((t) => t[2]));
    out.push(entry);
  }
  return out;
}

/** The heading a page without a `section:` is listed under, inside its part. */
export const GENERAL_SECTION = 'General';

/**
 * A page's `section:` frontmatter, or `General`. Anything but a non-empty string falls back
 * rather than throwing — `tests/unit/docs_tree.test.mjs` is where a bad value goes red.
 */
export function sectionOf(meta) {
  const s = meta.section;
  return typeof s === 'string' && s.trim() ? s.trim() : GENERAL_SECTION;
}

/**
 * Pages already in `order:` order, regrouped so each section's pages sit together.
 *
 * SECTION ORDER IS THE SMALLEST `order:` AMONG ITS PAGES — which, on a list already sorted by
 * order, is simply the order in which sections first appear. Within a section the pages keep
 * their `order:` order. One rule for the list, the breadcrumb and prev/next alike, so the
 * console never shows two orders for one part.
 */
export function bySection(pages) {
  const runs = new Map();
  for (const p of pages) {
    if (!runs.has(p.section)) runs.set(p.section, []);
    runs.get(p.section).push(p);
  }
  return [...runs.values()].flat();
}

// ---- markdown tables as data ------------------------------------------------------------

/** One table row's cells; a `\|` inside a cell is kept as a literal bar. */
function tableCells(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/)
    .map((c) => c.trim().replace(/\\\|/g, '|'));
}

/**
 * The body rows of the first table whose header, lower-cased, is exactly `head` — or `null`.
 *
 * A TABLE IS THE DATA so a page reads the same on GitHub as in the console: the map on
 * understand page 2 and the glossary are both tables a person can read, and the console builds
 * its richer view from the same rows rather than from a second copy that could drift. A row
 * with the wrong number of cells is a malformed table, so the whole answer is `null`.
 */
export function tableRows(body, head) {
  const lines = body.split('\n');
  for (let i = 0; i + 1 < lines.length; i += 1) {
    if (!lines[i].trim().startsWith('|')) continue;
    const h = tableCells(lines[i]).map((c) => c.toLowerCase());
    if (h.length !== head.length || h.some((c, j) => c !== head[j])) continue;
    const rows = [];
    for (let j = i + 2; j < lines.length && lines[j].trim().startsWith('|'); j += 1) {
      const row = tableCells(lines[j]);
      if (row.length !== head.length) return null;
      rows.push(row);
    }
    return rows;
  }
  return null;
}

const MAP_HEAD = ['piece', 'what it does for you', 'kind', 'cost', 'turn it off'];
export const MAP_KINDS = ['enforced', 'automatic', 'asked', 'on demand'];

/** The "what lands on your machine" table as rows, or `null` when absent or malformed. */
export function parseMapTable(body) {
  const rows = tableRows(body, MAP_HEAD);
  if (!rows || !rows.length) return null;
  const out = rows.map(([piece, does, kind, cost, off]) => (
    { piece, does, kind: kind.toLowerCase(), cost, off }));
  return out.every((r) => MAP_KINDS.includes(r.kind)) ? out : null;
}

const GLOSSARY_HEAD = ['term', 'theme key', 'meaning', 'in dev terms'];

/**
 * The glossary table: term, the theme key whose value renames it (`—` when no theme does),
 * the meaning, and the developer analogy (`—` when there is none).
 */
export function parseGlossaryTable(body) {
  const rows = tableRows(body, GLOSSARY_HEAD);
  if (!rows) return [];
  const dash = (s) => (s === '—' || s === '-' || s === '' ? null : s);
  return rows.map(([label, key, desc, analogy]) => (
    { label, key: dash(key), desc, analogy: dash(analogy) }));
}

// ---- links between pages ----------------------------------------------------------------

const MD_LINK_RE = /\]\((?!https?:|#|mailto:)([^)\s]+?\.md)(#[^)\s]*)?\)/g;
// ponytail: the canonical repo, not the install's origin; a fork's console links upstream.
const GITHUB_BLOB = 'https://github.com/Arylmera/Geneseed/blob/main/';

/**
 * Relative `.md` links, which is how the pages link on GitHub, rewritten for the console.
 *
 * A target that is a docs page becomes `#/docs/<id>` (its `#anchor` dropped — the console
 * addresses pages, not headings); any other repo file — a maintainer doc, a README under
 * `src/` — opens on GitHub, since the console does not serve it. Absolute URLs, in-page
 * anchors and fenced examples are left alone.
 */
export function rewriteDocLinks(body, fromRel, idByRel) {
  if (!body.includes('.md')) return body;
  let inFence = false;
  return body.split('\n').map((line) => {
    if (line.startsWith('```')) { inFence = !inFence; return line; }
    if (inFence) return line;
    return line.replace(MD_LINK_RE, (m, target, anchor) => {
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(fromRel), target));
      const id = idByRel.get(resolved);
      return id ? `](#/docs/${id})` : `](${GITHUB_BLOB}${resolved}${anchor ?? ''})`;
    });
  }).join('\n');
}

function idsByRel() {
  return new Map(docSources().map((s) => [s.rel, s.id]));
}

// ---- counts substituted into concept bodies -------------------------------------------

/**
 * Exported so the tier tokens can be gated on the day they are ADDED rather than on the day
 * a page first spends one. Only one page carries `{N_LAWS}` today; a test that could only
 * reach these through a rendered body would leave most of them untested.
 */
export function docCounts(state) {
  const inv = state.inventory;
  const plugins = path.join(ROOT, 'adapters', 'opencode', 'plugins');
  let n = 0;
  try {
    n = readdirSync(plugins).filter((f) => f.startsWith('geneseed-') && f.endsWith('.js'))
      .length;
  } catch { n = 0; }
  // `{N_LAWS}` IS THE INVARIANT COUNT AND NOTHING ELSE. The doctor's frozen
  // `proseMirrorProblems` holds README and SHIPPED.md prose to the same number, so a token
  // that quietly meant "the whole constitution" would put the docs and the gate at odds with
  // no way to re-bless either. The other three tiers get their own tokens.
  const packs = inv.doctrines ?? [];
  const on = packs.filter((p) => p.active);
  return {
    '{N_LAWS}': (inv.laws || []).length,
    '{N_AGENTS}': (inv.agents || []).length,
    '{N_SKILLS}': (inv.skills || []).length,
    '{N_PLUGINS}': n,
    '{N_ONTOLOGY}': (inv.ontology ?? []).length,
    '{N_PACKS}': packs.length,
    '{N_PACKS_ACTIVE}': on.length,
    // Rules in the packs this install BUILT IN — the number a reader of these pages is
    // actually bound by. The catalogue always ships whole, so it is never the smaller claim.
    '{N_DOCTRINE_RULES}': on.reduce((t, p) => t + p.rules.length, 0),
  };
}

function subCounts(state, body) {
  if (!body.includes('{N_')) return body;
  let out = body;
  for (const [token, n] of Object.entries(docCounts(state))) {
    out = out.split(token).join(String(n));
  }
  return out;
}

// ---- harness filtering -----------------------------------------------------------------

/**
 * The Docs selector names a HOST; a tag names a host or a FAMILY. Bob and OpenClaude emit
 * through the Claude engine, so a `claude` tag (page or block) is the Claude family and shows
 * to all three of them, while `bob` / `openclaude` narrow to the one host. `name` is how a
 * host-only passage's visible label spells the host. One row per host: the family table, the
 * host list and both marker patterns below are read off it.
 */
const DOC_HOSTS = {
  opencode: { family: 'opencode', name: 'OpenCode' },
  claude: { family: 'claude', name: 'Claude Code' },
  openclaude: { family: 'claude', name: 'OpenClaude' },
  bob: { family: 'claude', name: 'IBM Bob' },
};
export const HOST_FAMILY = Object.fromEntries(
  Object.entries(DOC_HOSTS).map(([id, h]) => [id, h.family]));
export const HARNESSES = Object.keys(DOC_HOSTS);
const anyOf = (words) => `(?:${words.join('|')})`;
/**
 * A page or block tagged `tag` shows to `host`. Untagged content shows to every host. One tag
 * names a host or a family; a LIST names hosts exactly, no family widening, because picking
 * some hosts of a family is the only thing a list says that one tag cannot:
 * `["claude", "openclaude"]` is Claude Code and OpenClaude, not Bob.
 */
export const harnessShows = (tag, host) => (Array.isArray(tag)
  ? tag.includes(host)
  : !tag || tag === host || tag === HOST_FAMILY[host]);
/** A block's tag: `claude` alone, or `claude,openclaude` — the list, read as above. */
const harnessTag = (raw) => (raw.includes(',') ? raw.split(/\s*,\s*/) : raw);
const HOST_ID = anyOf(HARNESSES);
const HARNESS_OPEN_RE = new RegExp(String.raw`^\s*<!--\s*harness:(${HOST_ID}(?:\s*,\s*${HOST_ID})*)\s*-->\s*$`);
const HARNESS_CLOSE_RE = /^\s*<!--\s*\/harness\s*-->\s*$/;
/**
 * The cheap presence test for the early-out. It must never be NARROWER than the open
 * pattern above — a stray-spaced marker would then slip the guard and leak unstripped —
 * which is why it allows the same `\s*` after `<!--`.
 */
const HARNESS_HINT_RE = /<!--\s*harness:/;

export function normHarness(value, state) {
  const v = (value || '').trim().toLowerCase();
  if (HARNESSES.includes(v)) return v;
  // Emit names start with their host id (`claude-global`, `bob`, …); `files` reads OpenCode's.
  const emit = String(state.emit || '');
  return HARNESSES.find((h) => emit.startsWith(h)) || 'opencode';
}

/**
 * Every open has a matching close, with no nesting.
 *
 * A marker inside a ``` fence is example text, not a marker (the same rule the frontend's
 * outline uses). Its purpose is to FAIL OPEN: an unbalanced marker leaves the body untouched,
 * so a typo can never blank the rest of a page.
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

/**
 * The visible `*(OpenCode only)*` line a block opens with. It exists for GitHub, which hides
 * the marker; the console has already filtered the block to the reader's host, so there the
 * label only repeats what the host selector says, and it goes with the marker.
 */
const HOST_NAME = anyOf(Object.values(DOC_HOSTS).map((h) => h.name));
const HOST_LABEL_RE = new RegExp(String.raw`^\s*\*\(${HOST_NAME}(?: and ${HOST_NAME})* only\)\*\s*$`);

export function stripHarnessBlocks(body, harnessName) {
  if (!HARNESS_HINT_RE.test(body)) return body;
  const lines = splitLines(body);
  if (!harnessBlocksBalanced(lines)) return body;
  const out = [];
  let keep = true;
  let inFence = false;
  let afterOpen = false;
  for (const line of lines) {
    const labelSlot = afterOpen;
    afterOpen = false;
    if (line.startsWith('```')) {
      inFence = !inFence;
      if (keep) out.push(line);
      continue;
    }
    if (!inFence) {
      const m = HARNESS_OPEN_RE.exec(line);
      if (m) { keep = harnessShows(harnessTag(m[1]), harnessName); afterOpen = true; continue; }
      if (HARNESS_CLOSE_RE.test(line)) { keep = true; continue; }
      if (labelSlot && HOST_LABEL_RE.test(line)) continue;
    }
    if (keep) out.push(line);
  }
  return out.join('\n');
}

/**
 * NOT a bare `split('\n')`: this drops a single trailing newline instead of yielding a
 * final empty string, and that difference reaches the output here because the result is
 * re-joined with `\n`.
 */
function splitLines(s) {
  const parts = s.split('\n');
  if (parts.length && parts[parts.length - 1] === '') parts.pop();
  return parts;
}

/** Pure; the registry is never mutated. */
function visibleGroups(harnessName) {
  const groups = [];
  for (const g of docGroups()) {
    if (!harnessShows(g.harness, harnessName)) continue;
    const pages = g.pages.filter((p) => harnessShows(p.harness, harnessName));
    if (pages.length) groups.push({ ...g, pages });
  }
  return groups;
}

// ---- heading slugs -----------------------------------------------------------------------

const SLUG_STRIP_RE = new RegExp(`[^a-z0-9${WHITESPACE}-]`, 'g');
const SLUG_WS_RE = new RegExp(`[${WHITESPACE}]+`, 'g');
const SLUG_DASH_RE = /-+/g;

/**
 * The same rules the frontend's `slug()` uses for the id it gives a rendered heading.
 *
 * `WHITESPACE` and `stripWhitespace` rather than `\s` and `trim()` — see `WHITESPACE`'s own
 * docblock for the measured set of characters where this matters.
 */
export function slugifyHeading(text) {
  let s = stripWhitespace(text.toLowerCase()).replace(SLUG_STRIP_RE, '');
  s = s.replace(SLUG_WS_RE, '-').replace(SLUG_DASH_RE, '-');
  return s.replace(/^-+|-+$/g, '');
}

// ---- the endpoints -----------------------------------------------------------------------

function findDocPage(pageId) {
  for (const g of docGroups()) {
    for (const p of g.pages) if (p.id === pageId) return p;
  }
  return null;
}

/**
 * A markdown file relative to ROOT, guarded against escapes the same way the catalog is. A
 * GET carries no token, so `rel` comes out of the registry, but the guard is what makes
 * that safe to say.
 */
function readDocSource(rel) {
  const target = resolvePath(path.join(ROOT, rel));
  if (!within(target, ROOT) || !isFile(target)) throw new NotFound(rel);
  return readMaybe(target) ?? '';
}

/** The deployed theme's words beside the neutral ones, from `docs/reference/glossary.md`. */
function glossary(state, page) {
  const load = (theme) => {
    const doc = readJsonMaybe(path.join(THEMES, `${theme}.json`));
    return doc && typeof doc === 'object' && !Array.isArray(doc) ? doc : {};
  };
  const neutral = load('neutral');
  const themed = state.theme !== 'neutral' ? load(state.theme) : neutral;
  const rows = [];
  for (const { label, key, desc, analogy } of parseGlossaryTable(page.body ?? '')) {
    if (key === null) {
      const term = label.toLowerCase();
      rows.push({ label, neutral: term, themed: term, desc, analogy });
      continue;
    }
    rows.push({
      label,
      neutral: String(Object.hasOwn(neutral, key) ? neutral[key] : '').trim(),
      themed: String(Object.hasOwn(themed, key) ? themed[key] : '').trim(),
      desc,
      analogy,
    });
  }
  return { theme: state.theme, rows };
}

/**
 * The About page: a version line, the deployed install, and the links.
 *
 * `repo` is the install's OWN git origin (where updates come from), and `repo_is_github` is
 * what gates the github-shaped deep links in the UI. Both come from `originDisplay()`,
 * which shells out to `git remote get-url` (the `git` row in `ALLOWED_SPAWNS`).
 *
 * `version` carries the status snapshot's fingerprints under the names the About page reads.
 * It used to read a `version` key the snapshot never had, so the page's build rows were
 * always empty; the snapshot spells them `installed_fp` / `source_fp` / `version_verdict`.
 *
 * THERE IS NO INTERPRETER FIELD, and the absence is deliberate — see `apiSetup` in
 * `api.mjs`, which spells the same absence for the same reason.
 */
function about(state) {
  const sd = statusData();
  const od = originDisplay();
  return {
    version: {
      installed_fp: sd.installed_fp, source_fp: sd.source_fp, verdict: sd.version_verdict,
    },
    theme: state.theme,
    emit: state.emit,
    deployed: deployed(state),
    target: String(state.target),
    root: String(ROOT),
    repo: od.url,
    // `githubSlug`, not `github_slug` — the record itself is camelCase like every other
    // object in this codebase; the RESPONSE key below is snake_case because that is the
    // wire format. Reading the wrong spelling off the record gives `undefined`, which is a
    // perfectly plausible `false`: the About page would silently drop every github deep
    // link and nothing else would change.
    repo_is_github: Boolean(od.githubSlug),
    license: 'MIT',
  };
}

export function apiDocs(state, harnessName = null) {
  const hn = normHarness(harnessName, state);
  const groups = visibleGroups(hn).map((g) => ({
    id: g.id,
    label: g.label,
    pages: g.pages.map((p) => ({ id: p.id, title: p.title, kind: p.kind, section: p.section,
      ...(typeof p.description === 'string' ? { description: p.description } : {}) })),
  }));
  return { groups, harness: hn };
}

/**
 * The lookup deliberately ignores a page's own `harness` tag: a deep link to a page the
 * active harness hides still resolves, and the client redirects it out of view.
 */
export function apiDocsPage(state, pageId, harnessName = null) {
  const page = findDocPage(pageId);
  if (!page) throw new NotFound(pageId);
  const hn = normHarness(harnessName, state);
  const render = KIND_ROUTES[page.kind];
  if (render !== undefined) return render(state, pageId, page, hn);
  throw new NotFound(pageId);
}

/**
 * The six kinds, as a TABLE and not six `if`s.
 *
 * `tests/unit/web_server.test.mjs` holds `Object.keys(KIND_ROUTES)` against a written-out
 * list of the kinds `apiDocsPage` must dispatch on — this table is what the dispatcher
 * actually consults, so a declaration-only check cannot see a dispatcher that stopped
 * using it.
 */
const KIND_ROUTES = {
  markdown: (state, pageId, page, hn) => {
    const body = rewriteDocLinks(stripHarnessBlocks(readDocSource(page.source), hn),
      page.source, idsByRel());
    return { id: pageId, title: page.title, kind: 'markdown', body,
      source: page.source, links: resolveLinks(state, body) };
  },
  concept: (state, pageId, page, hn) => {
    const body = rewriteDocLinks(subCounts(state, stripHarnessBlocks(page.body ?? '', hn)),
      page.rel, idsByRel());
    return { id: pageId, title: page.title, kind: 'concept', body,
      link: page.link ?? null, links: resolveLinks(state, body) };
  },
  // A concept page plus the rows of its own map table, for the console's map view.
  map: (state, pageId, page, hn) => {
    const body = rewriteDocLinks(stripHarnessBlocks(page.body ?? '', hn), page.rel, idsByRel());
    return { id: pageId, title: page.title, kind: 'map', body, rows: parseMapTable(body),
      links: resolveLinks(state, body) };
  },
  glossary: (state, pageId, page) => ({
    id: pageId, title: page.title, kind: 'glossary', ...glossary(state, page),
  }),
  about: (state, pageId, page) => ({
    id: pageId, title: page.title, kind: 'about', ...about(state),
  }),
  // The row is one line because the work was not in the page: it was in making the CLI's
  // metadata (`js/cli-table.json`) a file this reads directly.
  cli: (state, pageId, page) => ({
    id: pageId, title: page.title, kind: 'cli', ...cliReference(),
  }),
};

export const KINDS = Object.keys(KIND_ROUTES);
