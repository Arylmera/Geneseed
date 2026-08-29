/**
 * The web console's Docs pages, and the registry built from `docs/web/`.
 *
 * `cli` docs render via `cliReference()` in `js/ui/cli.mjs`, which reads
 * `js/cli-table.json` — the CLI's own metadata, since `harness.build_argparser()`'s parser
 * is not something a Node twin can introspect. `bin/geneseed-cli.mjs`'s `VERBS` table reads
 * the same file, so there is exactly one description of the CLI surface, not a second
 * transcription of it.
 *
 * `tests/unit/web_server.test.mjs` holds `KINDS` against a written-out list of the five
 * kinds this daemon dispatches on — same declaration-vs-dispatch shape as the route table,
 * which is why it is a table here too and not five `if`s.
 *
 * THE `?harness=` QUERY PARAM IS the Docs selector, and it is the ONLY input to these
 * endpoints that is not the checkout itself — the one thing a test can vary. Every
 * filtering rule below is exercised by sending both values over one page.
 */
import { readdirSync } from 'node:fs';
import path from 'node:path';

import { ROOT, THEMES } from '../build/source.mjs';
import { cliReference } from '../ui/cli.mjs';
import { readJsonMaybe, readMaybe } from '../hosts/installs.mjs';
import { resolvePath } from '../hosts/hosts.mjs';
import { parseJson } from '../lib/json.mjs';
import { isFile } from '../lib/fs.mjs';
import { normcase } from '../lib/paths.mjs';
import { WHITESPACE, stripWhitespace } from '../lib/text.mjs';
import { statusData } from '../inspect/status.mjs';
import { originDisplay } from '../maintain/update.mjs';
import { NotFound, deployed, resolveLinks } from './api.mjs';

const DOC_DIR = path.join(ROOT, 'docs', 'web');

/**
 * A docs page split into its frontmatter map and its body.
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
    // `parseJson`, so a frontmatter number keeps the int/float distinction the rest of
    // this codebase protects.
    try { meta[key] = parseJson(raw); } catch { meta[key] = raw; }
  }
  return [meta, body];
}

/**
 * The Docs registry, built from `docs/web/`.
 *
 * A page whose file is missing or malformed is skipped rather than crashing the server; an
 * unreadable registry yields an empty Docs section, which the UI renders as "no pages".
 *
 * NOT cached at module load. The difference is invisible to a request — `docs/web/` cannot
 * change under a running daemon any more than `dist/` can — and a module-level constant
 * would freeze whatever `ROOT` was when this file was first imported.
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
    // STABLE sort: equal orders keep filename order.
    entry.pages = entry.pages
      .map((pair, i) => [pair[0], i, pair[1]])
      .sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]))
      .map((t) => t[2]);
    out.push(entry);
  }
  return out;
}

/**
 * The neutral term, the theme key whose value renames it, and the one-line description. A
 * key of `null` marks a term no theme renames.
 */
const GLOSSARY_KEYS = [
  // The three tiers, in constitutional order and before the entities — a reader who does not
  // know what an Ontology is here cannot read the rest of the glossary's first rows.
  ['Ontology', 'ONTOLOGY', 'the always-on worldview under the rules — telos, evidence, '
    + 'decisions, conduct; it holds the Pact'],
  ['Rule (Law)', 'LAW', 'one of the nine always-on invariants: what is never done'],
  ['Rules (Laws)', 'LAWS', 'the body of always-on invariants'],
  ['Doctrine', 'DOCTRINE', 'one practice rule, cited `<pack> <n>` — how work is done here'],
  ['Doctrines', 'DOCTRINES', 'the practice packs, chosen at build time; inactive packs still '
    + 'ship in the bundle'],
  ['Agent', 'AGENT', 'a capability specialist'],
  ['Agents', 'AGENTS', 'the roster of specialists'],
  ['Skill', 'SKILL', 'a repeatable workflow'],
  ['Skills', 'SKILLS', 'the catalogue of workflows'],
  ['Memory', 'MEMORY', 'durable, one-fact-per-file knowledge'],
  ['Notebook', 'NOTEBOOK', "the agent's sovereign space"],
  ['Wiki', 'WIKI', 'the machine-wide knowledge base'],
  // Still a token, still themed, but it names a CONCEPT INSIDE the ontology's Telos now
  // rather than a peer of the Rules — `src/postures/peer.md` cites it and the section that
  // used to carry it is the Ontology.
  ['Pact', 'PACT', "the two-way collaboration contract, stated in the Ontology's Telos"],
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

const HARNESSES = ['opencode', 'claude'];
const HARNESS_OPEN_RE = /^\s*<!--\s*harness:(opencode|claude)\s*-->\s*$/;
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
  return String(state.emit || '').startsWith('claude') ? 'claude' : 'opencode';
}

/**
 * Every open has a matching close, with no nesting.
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

export function stripHarnessBlocks(body, harnessName) {
  if (!HARNESS_HINT_RE.test(body)) return body;
  const lines = splitLines(body);
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
    if (g.harness && g.harness !== harnessName) continue;
    const pages = g.pages.filter((p) => !p.harness || p.harness === harnessName);
    if (pages.length) groups.push({ ...g, pages });
  }
  return groups;
}

// ---- slugs and section slicing ----------------------------------------------------------

const SLUG_STRIP_RE = new RegExp(`[^a-z0-9${WHITESPACE}-]`, 'g');
const SLUG_WS_RE = new RegExp(`[${WHITESPACE}]+`, 'g');
const SLUG_DASH_RE = /-+/g;
const HEADING_RE = /^(#{1,6})\s+(.+?)\s*$/;

/**
 * The same rules the frontend's `slug()` uses, so a registry `anchor` written against a
 * heading matches the id the renderer assigns.
 *
 * `WHITESPACE` and `stripWhitespace` rather than `\s` and `trim()` — see `WHITESPACE`'s own
 * docblock for the measured set of characters where this matters.
 */
export function slugifyHeading(text) {
  let s = stripWhitespace(text.toLowerCase()).replace(SLUG_STRIP_RE, '');
  s = s.replace(SLUG_WS_RE, '-').replace(SLUG_DASH_RE, '-');
  return s.replace(/^-+|-+$/g, '');
}

/**
 * The body trimmed to one heading's section.
 *
 * Returns `[body, ok]`; `ok === false` (with the ORIGINAL body) when the anchor is
 * missing, so the caller falls back to the whole document. An H1 slice stops at the first
 * H2 — `max(level, 2)` — so it captures an intro paragraph rather than the whole file.
 */
export function sliceSection(body, anchor) {
  const lines = splitLines(body);
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

function within(child, parent) {
  const c = normcase(child).split(/[\\/]/);
  const p = normcase(parent).split(/[\\/]/);
  return p.length <= c.length && p.every((seg, i) => c[i] === seg);
}

/** The deployed theme's words beside the neutral ones. */
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
 * The About page: a version line, the deployed install, and the links.
 *
 * `repo` is the install's OWN git origin (where updates come from), and `repo_is_github` is
 * what gates the github-shaped deep links in the UI. Both come from `originDisplay()`,
 * which shells out to `git remote get-url` (the `git` row in `ALLOWED_SPAWNS`).
 *
 * `version` IS NOT WHAT IT LOOKS LIKE, and it is the shape this page has always had rather than
 * a shortcut here. It reads a `version` key off the status snapshot and THERE IS NO SUCH KEY —
 * the snapshot spells the fingerprints `source_fp` / `installed_fp` / `version_verdict`. So the
 * field is `{}`, always, and `sd.version || {}` reproduces the EXPRESSION rather than the
 * constant: if the key ever appears, the page gains it without another edit.
 *
 * THERE IS NO INTERPRETER FIELD, and the absence is deliberate — see `apiSetup` in
 * `api.mjs`, which spells the same absence for the same reason.
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
    pages: g.pages.map((p) => ({ id: p.id, title: p.title, kind: p.kind })),
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
 * The five kinds, as a TABLE and not five `if`s.
 *
 * `tests/unit/web_server.test.mjs` holds `Object.keys(KIND_ROUTES)` against a written-out
 * list of the kinds `apiDocsPage` must dispatch on — this table is what the dispatcher
 * actually consults, so a declaration-only check cannot see a dispatcher that stopped
 * using it.
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
  // The row is one line because the work was not in the page: it was in making the CLI's
  // metadata (`js/cli-table.json`) a file this reads directly.
  cli: (state, pageId, page) => ({
    id: pageId, title: page.title, kind: 'cli', ...cliReference(),
  }),
};

export const KINDS = Object.keys(KIND_ROUTES);
