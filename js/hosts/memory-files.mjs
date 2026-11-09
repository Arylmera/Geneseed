/**
 * The memory store's file format — fact files with frontmatter, the `MEMORY.md` index, the
 * per-agent lesson files — read and written without spawning anything.
 *
 * SPLIT FROM `learn` FOR THE CLI's SAKE. `learn` spawns the model CLI, and the web console
 * (`js/web/api.mjs`, `js/web/actions.mjs`), `geneseed memory` (`js/maintain/memory.mjs`) and the
 * loop catalogue (`js/loop/catalog.mjs`) imported the hook module only for `frontmatter` and
 * `memoryDropIndex` — which dragged Node's child-process module into `bin/geneseed-cli.mjs`'s
 * closure (the generator now imports this file too, and its spawn ban greps for that literal)
 * and made the hook module a row in `tests/unit/hook_cli.test.mjs`'s spawn allow-list for a
 * spawn the CLI never makes. Everything here is fs-only; `hooks-learn.mjs` is the one spawner.
 *
 * `user-rules.md`'s parser lives here too, and the draft's format and the fold's ledger reader: the
 * web console edits or shows through them and the fold writes through them, and the build may not
 * import `js/web` (spec C20).
 */
import { isUtf8 } from 'node:buffer';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmdirSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { readText, writeText, writeTextAtomic } from '../lib/fs.mjs';
import { isDict } from '../lib/json.mjs';
import { normcase } from '../lib/paths.mjs';
import { WHITESPACE, stripWhitespace } from '../lib/text.mjs';
import { isFile, listDir, sortPaths, splitLines, splitWords } from './hooks-prims.mjs';

const FRONTMATTER_RE = /^\s*---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/;
const FILE_SEP_RE = /^---FILE---[^\S\n]*$/m;
// A memory `name:` becomes a FILENAME and the model writes it, so it is a plain slug or
// nothing — no separator, no `..`, no drive. Looser than `hooks-learn.mjs`'s AGENT_NAME_RE on
// purpose: a memory slug is a phrase (case and length vary), and a refused one is a fact
// silently lost.
const MEMORY_SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/;
const MAX_AGENT_BULLETS = 100;

/**
 * The seed MEMORY.md body. `js/build/stubs.mjs` seeds it from here, and an emptied store is
 * written back to exactly these bytes, so the context hook's seed hash keeps skipping it.
 */
export const MEMORY_SEED = '# Memory Index\n';

/**
 * THE INDEX HAS TWO LEVELS. MEMORY.md is a map of topics, injected every session. Each
 * `topics/<topic>.md` lists the facts under that topic, and the agent opens it on demand.
 * A flat one-line-per-fact index overran the context hook's session budget at about 200
 * facts and lost the newest ones, which is why it was split.
 */
const TOPICS = 'topics';
const MAP_HINT = 'Each topic file lists its facts; open the one the task needs.';
// A fact pointer: `- [title](slug.md)` in a legacy flat index, `- [title](../slug.md)` in a
// topic file. The slug may not hold a `/`, so a map line (`topics/x.md`) is never a fact.
const FACT_LINE_RE = /^- \[([^\]]*)\]\((?:\.\.\/)?([^/)]+)\.md\)(.*)$/;
const MAP_LINE_RE = /^- \[[^\]]*\]\(topics\/[^)]+\.md\)/;

/**
 * `append_agent_lesson` — one dated bullet, capped at the newest MAX_AGENT_BULLETS.
 *
 * A FILE THAT IS NOT UTF-8 IS LEFT WHOLE, the fold's rule (`foldRules` in js/build/fold.mjs): the
 * read below replaces each bad byte, so rewriting the file would change a line nobody touched.
 * The lesson is dropped and the answer is null; the caller says so. The tier's agent files are
 * the ones that can be hand-edited in another encoding.
 */
export function appendAgentLesson(memDir, agent, lesson) {
  const d = path.join(memDir, 'agents');
  mkdirSync(d, { recursive: true });
  const f = path.join(d, `${agent}.md`);
  let bullets = [];
  if (existsSync(f)) {
    const raw = readFileSync(f);
    if (!isUtf8(raw)) return null;
    bullets = splitLines(raw.toString('utf8')).filter((l) => l.startsWith('- '));
  }
  const now = new Date();
  const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-`
    + `${String(now.getDate()).padStart(2, '0')}`;
  bullets.push(`- ${day}: ${splitWords(lesson).join(' ')}`);
  bullets = bullets.slice(-MAX_AGENT_BULLETS);
  writeText(f, `# ${agent} \u2014 lessons\n${bullets.join('\n')}\n`);
  return f;
}

/**
 * `_frontmatter` — leading YAML-ish frontmatter as a flat map, plus the body.
 *
 * Exported since P6b, whose `memoryItems` reads `name` and `description` off a fact file
 * exactly as `_web_catalog._memory_items` does. That makes the web its SECOND owner, which
 * this port treats as a coverage event rather than a tidiness one — the fields it produces
 * are unreachable from a P6b cell (only the COUNT is consumed) and P6c's catalog cells are
 * what gate them.
 */
export function frontmatter(md) {
  const m = FRONTMATTER_RE.exec(md);
  if (!m) return [new Map(), md];
  const fm = new Map();
  for (const line of splitLines(m[1])) {
    const at = line.indexOf(':');
    if (at >= 0) {
      // `str.strip('"')` strips the character from BOTH ends, however many there are.
      fm.set(line.slice(0, at).trim(), line.slice(at + 1).trim().replace(/^"+|"+$/g, ''));
    }
  }
  return [fm, m[2]];
}

const fmGet = (fm, key) => (fm.has(key) ? fm.get(key) : '');

/** `Path.stem` for a filename. */
const stem = (name) => path.basename(name, path.extname(name));

/** `mem_dir.glob("*.md")` — case-INSENSITIVE on Windows, as pathlib's glob is. */
function globMd(dir) {
  return listDir(dir).filter((n) => normcase(n).endsWith('.md')
    && isFile(path.join(dir, n)));
}

/** Stems that name the store's own files, never a fact — `MEMORY` is the index itself. */
export const RESERVED_STEMS = new Set(['memory', 'readme']);

/**
 * `_existing_slugs` — slugs already stored. learn never CREATES one of these; it may only
 * update or archive it by name (`writeMemories`).
 */
export function existingSlugs(memDir) {
  return new Set(globMd(memDir).map(stem).filter((s) => !RESERVED_STEMS.has(s.toLowerCase())));
}

/**
 * How many facts a store holds, by the same test the console's list uses. No folder is no facts
 * (0); a folder that cannot be listed is null, so a row says "not read" rather than "no facts".
 * The first listing is only for that answer: `existingSlugs` reads a failure as empty.
 */
export function factCount(store) {
  try { readdirSync(store); } catch (e) { return e?.code === 'ENOENT' ? 0 : null; }
  return existingSlugs(store).size;
}

/** Lines of a text file, or null when it cannot be read. */
function readLines(p) {
  try { return splitLines(readText(p)); } catch { return null; }
}

/**
 * Write `text` only when the file does not already hold it. A second run of a rebuild then
 * touches nothing, which keeps `golden --idempotent` green and leaves the user's mtimes alone.
 */
function writeIfChanged(p, text) {
  const old = readLines(p);
  if (old && `${old.join('\n')}\n` === text) return;
  writeTextAtomic(p, text);
}

/** A topic name as a file stem: `[a-z0-9-]`, any other run becomes `-`, empty becomes `misc`. */
function topicSlug(raw) {
  return raw.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'misc';
}

/**
 * The topic a fact files under: `topic:`, else `type:`, else `misc`.
 *
 * NESTED `type:` IS ACCEPTED ON PURPOSE. The flat frontmatter parser trims keys, so Claude
 * Code's own memory shape, with `type:` indented under `metadata:`, reads as `type`.
 */
const topicOf = (fm) => topicSlug(fmGet(fm, 'topic') || fmGet(fm, 'type'));

/**
 * Every fact on disk, in the index's sort order: slug -> { desc, topic }. Top level only, so
 * `archive/` and `agents/` are never facts. Exported for learn's prompt, which lists them.
 */
export function readFacts(memDir) {
  const facts = new Map();
  for (const name of sortPaths(globMd(memDir))) {
    const s = stem(name);
    if (RESERVED_STEMS.has(s.toLowerCase())) continue;
    try {
      const [fm] = frontmatter(readText(path.join(memDir, name)));
      facts.set(s, { desc: fmGet(fm, 'description').trim(), topic: topicOf(fm) });
    } catch { continue; }
  }
  return facts;
}

/**
 * Every fact pointer the index holds now, from a flat MEMORY.md and from the topic files:
 * slug -> { title, rest }. `rest` is everything after the link, hook text included.
 */
function indexedFacts(memDir) {
  const found = new Map();
  const tdir = path.join(memDir, TOPICS);
  const files = [path.join(memDir, 'MEMORY.md'), ...globMd(tdir).map((f) => path.join(tdir, f))];
  for (const f of files) {
    for (const line of readLines(f) ?? []) {
      const m = FACT_LINE_RE.exec(line.trim());
      if (m) found.set(m[2], { title: m[1], rest: m[3] });
    }
  }
  return found;
}

/**
 * What MEMORY.md holds that no index writer generated: the lines a person wrote.
 * `generated(slug)` says whether a flat pointer to that slug counts as generated too.
 */
export function indexNotes(memDir, generated) {
  return (readLines(path.join(memDir, 'MEMORY.md')) ?? []).filter((l) => {
    const t = l.trim();
    const flat = FACT_LINE_RE.exec(t);
    return t && t !== MEMORY_SEED.trim() && t !== MAP_HINT && !MAP_LINE_RE.test(t)
      && !(flat && generated(flat[2]));
  });
}

/**
 * Rewrite MEMORY.md as the map: one line per topic file with its fact count.
 *
 * LINES THE MAP DID NOT GENERATE ARE CARRIED, so a note the user wrote into the index
 * survives. `dropFlat` also drops legacy flat fact pointers; a rebuild passes it because it
 * has just moved them into topic files. With no topic and nothing carried, the file goes
 * back to the seed.
 */
function writeMap(memDir, dropFlat) {
  const idx = path.join(memDir, 'MEMORY.md');
  const carried = indexNotes(memDir, () => dropFlat);
  const tdir = path.join(memDir, TOPICS);
  const topics = globMd(tdir).map(stem).sort().map((t) => {
    const n = (readLines(path.join(tdir, `${t}.md`)) ?? [])
      .filter((l) => FACT_LINE_RE.test(l.trim())).length;
    return `- [${t}](${TOPICS}/${t}.md) — ${n} fact${n === 1 ? '' : 's'}`;
  });
  const body = [...(topics.length ? ['', MAP_HINT, '', ...topics] : []),
    ...(carried.length ? ['', ...carried] : [])];
  writeIfChanged(idx, body.length ? `${MEMORY_SEED}${body.join('\n')}\n` : MEMORY_SEED);
}

/** Remove the topics dir when nothing is left in it. */
function pruneTopicsDir(memDir) {
  try { rmdirSync(path.join(memDir, TOPICS)); } catch { /* not empty, or absent */ }
}

/**
 * Rebuild both index levels from the fact files on disk.
 *
 * A fact the index already points at keeps its existing line, title and hook included,
 * unless `refresh` is set. That makes a migration or a learn run lossless. `consolidate`
 * passes `refresh`, because it exists to re-read the descriptions; learn passes the slugs
 * it just UPDATED as `fresh`, because their old line describes a fact that is gone. Topic
 * files no topic uses any more are deleted: they are generated, never facts.
 */
function rebuildIndex(memDir, refresh, fresh = new Set()) {
  const facts = readFacts(memDir);
  const old = indexedFacts(memDir);
  const byTopic = new Map();
  for (const [slug, { desc, topic }] of facts) {
    const o = refresh || fresh.has(slug) ? null : old.get(slug);
    const line = o ? `- [${o.title}](../${slug}.md)${o.rest}`
      : `- [${slug}](../${slug}.md)${desc ? ` — ${desc}` : ''}`;
    if (!byTopic.has(topic)) byTopic.set(topic, []);
    byTopic.get(topic).push(line);
  }
  const tdir = path.join(memDir, TOPICS);
  for (const f of globMd(tdir)) {
    if (!byTopic.has(stem(f))) unlinkSync(path.join(tdir, f));
  }
  if (byTopic.size) mkdirSync(tdir, { recursive: true });
  for (const [topic, lines] of byTopic) {
    writeIfChanged(path.join(tdir, `${topic}.md`), `# ${topic}\n\n${lines.join('\n')}\n`);
  }
  if (!byTopic.size) pruneTopicsDir(memDir);
  writeMap(memDir, true);
  return { facts, old };
}

/**
 * Move a flat MEMORY.md to the two-level index, once, at emit time.
 *
 * Acts only when MEMORY.md still holds a flat fact pointer and at least one fact exists, so
 * a seed-only store and an already-migrated store are left alone. It rewrites MEMORY.md and
 * `topics/*.md` only, never a fact file, and it keeps each pointer's own title and hook.
 */
export function migrateMemoryIndex(memDir) {
  const lines = readLines(path.join(memDir, 'MEMORY.md'));
  if (!lines?.some((l) => FACT_LINE_RE.test(l.trim())) || !existingSlugs(memDir).size) return false;
  rebuildIndex(memDir, false);
  return true;
}

/** The chunk without its frontmatter `action:` line, which is an instruction, not the fact. */
function stripAction(chunk) {
  const lines = chunk.split('\n');
  const close = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
  if (lines[0].trim() !== '---' || close < 0) return chunk;
  return lines.filter((l, i) => i === 0 || i >= close || !/^\s*action\s*:/.test(l)).join('\n');
}

/**
 * Whether the stored fact carries a `force:`. Such a fact is never updated or archived by
 * learn: the memory README's Bridge rule has it revised inline with its supersession
 * recorded, a `constraint` only by the user, and the model sees no fact's body or `force:`.
 */
function hasForce(memDir, slug) {
  try { return !!fmGet(frontmatter(readText(path.join(memDir, `${slug}.md`)))[0], 'force'); } catch {
    return false;
  }
}

/**
 * Move `<slug>.md` into `archive/`, never over a file already there: a taken name gets
 * `-2`, `-3`, ... A counter rather than a date, so a second archive the same day cannot
 * collide. RENAME, never unlink: an archived fact leaves the index but stays on disk.
 * Returns the path it landed at. The index is the caller's: `geneseed memory rm` drops the
 * line (`memoryDropIndex`), learn rebuilds both levels.
 */
export function archiveFact(memDir, slug) {
  const adir = path.join(memDir, 'archive');
  mkdirSync(adir, { recursive: true });
  let dest = path.join(adir, `${slug}.md`);
  for (let n = 2; existsSync(dest); n += 1) dest = path.join(adir, `${slug}-${n}.md`);
  renameSync(path.join(memDir, `${slug}.md`), dest);
  return dest;
}

/**
 * `_write_memories` — split the model output into files and apply each, then rebuild the
 * two-level index from disk with the same builder `consolidate` uses. A rebuild rather than
 * an append, so a legacy flat index is migrated on the way and a topic count can never
 * drift from its file. `existing` is MUTATED to match the store afterwards.
 *
 * A chunk's frontmatter `action:` says what to do with its `name:`:
 *   - none (or `create`): write a NEW fact; a slug already stored is skipped;
 *   - `update`: archive the stored fact (`archiveFact`), then write this text, which the
 *     model has merged, in its place. The model sees only the description, so the old
 *     body, links and extra frontmatter survive in `archive/` and every update is reversible;
 *   - `archive`: move the stored fact to `archive/` (`archiveFact`).
 * An update or archive naming no stored fact, or one carrying a `force:` (`hasForce`), is
 * skipped, as is any other action, and each slug is acted on once per reply.
 *
 * A reserved stem is refused (`name: MEMORY` would overwrite the index), and names compare
 * LOWERCASE: on Windows and macOS `User-Prefs.md` and `user-prefs.md` are one file, so a
 * case variant of a stored slug would overwrite it. An update or archive therefore acts on
 * the STORED spelling, whatever case the model used.
 *
 * Returns `{ created, updated, archived }`, each a list of slugs.
 */
export function writeMemories(modelOutput, memDir, existing) {
  const stored = new Map([...existing].map((s) => [s.toLowerCase(), s]));
  const done = new Set();
  const res = { created: [], updated: [], archived: [] };
  for (let chunk of modelOutput.split(FILE_SEP_RE)) {
    chunk = chunk.trim();
    if (!chunk || chunk.toUpperCase() === 'NOTHING') continue;
    const [fm] = frontmatter(chunk);
    const name = fmGet(fm, 'name').trim();
    const key = name.toLowerCase();
    const action = fmGet(fm, 'action').trim().toLowerCase() || 'create';
    if (!MEMORY_SLUG_RE.test(name) || RESERVED_STEMS.has(key) || done.has(key)) continue;
    const slug = stored.get(key);
    if (slug && action !== 'create' && hasForce(memDir, slug)) continue;
    const body = `${stripAction(chunk).replace(/\n+$/, '')}\n`;
    if (action === 'create' && !slug) {
      writeText(path.join(memDir, `${name}.md`), body);
      existing.add(name);
      stored.set(key, name);
      res.created.push(name);
    } else if (action === 'update' && slug) {
      archiveFact(memDir, slug);   // the old version first: the model never saw its body
      writeText(path.join(memDir, `${slug}.md`), body);
      res.updated.push(slug);
    } else if (action === 'archive' && slug) {
      archiveFact(memDir, slug);
      existing.delete(slug);
      stored.delete(key);
      res.archived.push(slug);
    } else continue;
    done.add(key);
  }
  if (res.created.length || res.updated.length || res.archived.length) {
    rebuildIndex(memDir, false, new Set(res.updated));
  }
  return res;
}

/**
 * Remove the index line(s) naming `<name>.md`.
 *
 * ITS PYTHON HOME IS THE TUI, and it is here because this is where its SIBLINGS' twins are:
 * `appendAgentLesson` writes the index lines this deletes and `consolidateMemory` rebuilds
 * them, so the three rules about MEMORY.md's format live together rather than one of them
 * living beside a web endpoint. P7 ports the TUI's memory view onto this same function.
 *
 * The P6f plan asked whether P5's `learn` had already brought it across. It had not —
 * nothing in `js/` referenced it — which is the third time a plan's "already ported" column
 * was answered by reading rather than by trusting.
 *
 * SUBSTRING, NOT PARSE: any line containing `(<name>.md)` goes,
 * so a hand-written index in a different shape still loses its entry. And the file is only
 * REWRITTEN when something actually changed, which keeps a delete of an unindexed fact from
 * touching the user's mtime.
 *
 * BOTH LEVELS: the `(<name>.md)` line of a legacy flat MEMORY.md, and the `(../<name>.md)`
 * line of whichever topic file holds it. A topic file left with no fact is deleted, and the
 * map's counts are refreshed only when a topic file changed. Matching the two exact forms
 * keeps `b` from taking `ab.md` with it.
 */
export function memoryDropIndex(memDir, name) {
  dropLines(path.join(memDir, 'MEMORY.md'), `(${name}.md)`);
  const tdir = path.join(memDir, TOPICS);
  let touched = false;
  for (const f of globMd(tdir)) {
    const p = path.join(tdir, f);
    const left = dropLines(p, `(../${name}.md)`);
    if (!left) continue;
    touched = true;
    if (!left.some((l) => FACT_LINE_RE.test(l.trim()))) {
      try { unlinkSync(p); } catch { /* as below */ }
    }
  }
  if (!touched) return;
  pruneTopicsDir(memDir);
  try { writeMap(memDir, false); } catch { /* best-effort */ }
}

/** Drop every line holding `needle`; the kept lines when something went, else null. */
function dropLines(p, needle) {
  const lines = readLines(p);
  if (!lines) return null;        // unreadable: nothing to drop
  const keep = lines.filter((ln) => !ln.includes(needle));
  if (keep.length === lines.length) return null;
  try {
    writeTextAtomic(p, `${keep.join('\n')}\n`);
  } catch { /* best-effort */ }
  return keep;
}

/**
 * Move a runtime store aside to a sibling
 * `archived-<name>/<timestamp>/`.
 *
 * NEVER a delete. Memory is the one thing in this system a user cannot rebuild, so the
 * destructive verb's most destructive option is still a move.
 *
 * `renameSync` rather than a copy-then-delete: the destination is a SIBLING of the source, so
 * it is the same device by construction and a cross-device fallback has nothing to do.
 * shortcut: rename only, and the day a store can live on another volume this needs a copy path.
 *
 * `move` is `copyFileSync` for a file that must stay readable until its replacement lands.
 * `parent` is overridden only for a retired skill folder, whose sibling would sit inside the
 * host's `skills/` scan root and load again: it goes to `<cfg>/archived-skills/<name>/` instead.
 */
export function archiveStore(store, move = renameSync,
  parent = path.join(path.dirname(store), `archived-${path.basename(store)}`)) {
  // `toLocaleString('sv-SE')` — LOCAL time, matching the old hand-rolled stamp
  // (`getHours()`/`getMinutes()`/`getSeconds()` are all local-time getters, unlike
  // `toISOString()`'s UTC). sv-SE's default format is already zero-padded
  // "YYYY-MM-DD HH:MM:SS"; stripping the punctuation and reinserting one dash reproduces
  // the exact `YYYYMMDD-HHMMSS` shape the padStart version built by hand.
  const stamp = new Date().toLocaleString('sv-SE').replace(/\D/g, '').replace(/^(\d{8})/, '$1-');
  // A taken name gets `-2`, …: two moves in one second must not fail the second.
  let dest = path.join(parent, stamp);
  for (let n = 2; existsSync(dest); n += 1) dest = path.join(parent, `${stamp}-${n}`);
  mkdirSync(parent, { recursive: true });
  move(store, dest);
  return dest;
}

/**
 * `consolidate_memory` — rebuild both index levels from the fact files actually on disk:
 * index orphans, prune dead lines, refresh each line from its fact's description, report
 * duplicate descriptions. It REPORTS them and never merges: merging is a judgement, made by
 * the model at learn time (`writeMemories`'s `update`) or by the user, never by this rebuild. `added` and
 * `pruned` compare against the pointers of BOTH levels, so a migration counts as neither.
 */
export function consolidateMemory(memDir) {
  const { facts, old } = rebuildIndex(memDir, true);
  const seen = new Map();
  const dups = [];
  for (const [slug, { desc }] of facts) {
    if (desc && seen.has(desc)) dups.push([seen.get(desc), slug]);
    if (!seen.has(desc)) seen.set(desc, slug);
  }
  const added = [...facts.keys()].filter((s) => !old.has(s)).sort();
  const pruned = [...old.keys()].filter((s) => !facts.has(s)).sort();
  return { added, pruned, duplicates: dups };
}

/**
 * `## R<n> — Title`, anchored at column 0 so a rule body's fenced code and the stub's
 * indented format example never parse as rules.
 *
 * The whitespace classes are `WHITESPACE`, not `\s`: this pattern runs over a HAND-EDITED
 * file, which is where a non-breaking space actually turns up. `\S` is its complement for
 * the same reason.
 *
 * `\d` IS LEFT ASCII, and that is a declared divergence rather than an oversight, unlike
 * `ruleFields` (`js/web/user-files.mjs`), which uses `\p{Nd}`. No theme seeds a non-ASCII rule id, no build
 * writes one, and the web editor cannot produce one either — it writes `R<n>` itself from
 * `max(ids) + 1`. Widening this to match would only move the gap one line down, to whatever
 * parses the captured digits back into a number.
 */
const RULE_HEAD_RE = new RegExp(
  `^##[${WHITESPACE}]+R(\\d+)[${WHITESPACE}]*[—–-]+[${WHITESPACE}]*`
  + `([^${WHITESPACE}].*?)[${WHITESPACE}]*$`,
);

/**
 * A line `parseRules` reads as the edge of a rule: `## ` ends the current block, and a
 * `RULE_HEAD_RE` line opens one (a non-breaking space after `##` does the second, not the first).
 * ONE predicate for both the parser and `ruleFields`, so a body the writer accepts can never
 * split or forge a rule when read back.
 */
export const isRuleEdge = (line) => line.startsWith('## ') || RULE_HEAD_RE.test(line);

const META_RE = new RegExp(`^\\((.+)\\)[${WHITESPACE}]*$`);

/** `{}` when the line is body rather than metadata. */
function parseRuleMeta(line) {
  const m = META_RE.exec(stripWhitespace(line));
  if (!m) return {};
  const meta = {};
  for (const part of m[1].split('|')) {
    const at = part.indexOf(':');
    if (at < 0) continue;               // `partition` with no separator — not a pair
    const key = stripWhitespace(part.slice(0, at)).toLowerCase().replaceAll(' ', '_');
    if (['scope', 'source', 'trial_until'].includes(key)) {
      meta[key] = stripWhitespace(part.slice(at + 1));
    }
  }
  return meta;
}

/**
 * `user-rules.md` parsed to `[rules, warnings]`.
 *
 * Every rule carries its `start`/`end` LINE INDICES, which is what lets `apiRulesMutate`
 * splice exactly one block and leave every other byte of the user's file — prose,
 * formatting, hand-written sections — untouched.
 * @returns {[Array<{id: number, start: number, end: number} & Record<string, any>>, string[]]}
 */
export function parseRules(text) {
  const lines = splitLines(text);
  const rules = [];
  const warnings = [];
  const seen = new Set();
  for (let idx = 0; idx < lines.length; idx += 1) {
    const m = RULE_HEAD_RE.exec(lines[idx]);
    if (!m) continue;
    let end = lines.length;
    for (let j = idx + 1; j < lines.length; j += 1) {
      if (isRuleEdge(lines[j])) { end = j; break; }
    }
    const rid = Number(m[1]);
    if (seen.has(rid)) warnings.push(`duplicate rule id R${rid}`);
    seen.add(rid);
    let k = idx + 1;
    while (k < end && !stripWhitespace(lines[k])) k += 1;
    const meta = k < end ? parseRuleMeta(lines[k]) : {};
    if (Object.keys(meta).length) k += 1;
    rules.push({
      id: rid,
      title: m[2],
      scope: Object.hasOwn(meta, 'scope') ? meta.scope : 'project',
      source: Object.hasOwn(meta, 'source') ? meta.source : '',
      trial_until: Object.hasOwn(meta, 'trial_until') ? meta.trial_until : '',
      body: stripWhitespace(lines.slice(k, end).join('\n')),
      start: idx,
      end,
    });
  }
  return [rules, warnings];
}

// The draft's block headings: the fold writes them, `parseDraft` reads them, and the approval flow
// (src/skills/rule/approve.md, js/build/rule-decide.mjs) names them, so a change here changes both.
export const draftRuleHead = (host, title) => `## Rule from ${host}: ${title}`;
export const draftChoiceHead = (file) => `## Choose: ${file}`;
const DRAFT_RULE_RE = /^## Rule from ([^:]+): (.+)$/;
const DRAFT_CHOICE = draftChoiceHead('');

/**
 * The blocks of `user-rules.draft.md`, as `{title, host, key, body}`, in file order. A
 * `## Rule from <host>: <title>` block is a pointer line, then the rule. A `## Choose: <file>` block
 * is a question about two files, so it keeps its title alone. Every other heading (`## Renumbered`,
 * the file's record of past decisions) ends the block before it and adds none. `key` is the
 * pointer line's `sha256`, the block's row in the ledger.
 */
export function parseDraft(text) {
  const out = [];
  let open = null;
  for (const line of splitLines(text)) {
    if (line.startsWith('## ')) {
      const rule = DRAFT_RULE_RE.exec(line);
      open = rule ? { title: rule[2], host: rule[1], lines: [] }
        : line.startsWith(DRAFT_CHOICE) ? { title: line.slice(3), host: null, lines: [] } : null;
      if (open) out.push(open);
    } else open?.lines.push(line);
  }
  return out.map(({ title, host, lines }) => ({
    title, host, key: /sha256: (\w+)/.exec(lines[0] ?? '')?.[1],
    body: host ? stripWhitespace(lines.slice(1).join('\n')) : '',
  }));
}

/**
 * The ledger, or an empty one. One that holds nothing counts as empty and is written whole by the
 * next item, because a key set on `[]` never reaches the file and the item would be reported on
 * every emit. Anything else that is no ledger throws: treating it as empty would draft every
 * decided item again, and the failed step is what the user should see.
 */
export function readFoldState(shared) {
  const blank = (v) => v === null || v === undefined || (Array.isArray(v) && !v.length);
  if (!existsSync(shared.foldState)) return { version: 1, items: {} };
  const text = readFileSync(shared.foldState, 'utf8');
  const state = text.trim() ? JSON.parse(text) : null;
  if (blank(state)) return { version: 1, items: {} };
  if (!isDict(state) || !(blank(state.items) || isDict(state.items))) {
    throw new Error(`${shared.foldState} is not a ledger`);
  }
  if (blank(state.items)) state.items = {};
  return state;
}
