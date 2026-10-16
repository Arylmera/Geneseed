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
 */
import { existsSync, mkdirSync, renameSync, rmdirSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { readText, writeText } from '../lib/fs.mjs';
import { normcase } from '../lib/paths.mjs';
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

/** `append_agent_lesson` — one dated bullet, capped at the newest MAX_AGENT_BULLETS. */
export function appendAgentLesson(memDir, agent, lesson) {
  const d = path.join(memDir, 'agents');
  mkdirSync(d, { recursive: true });
  const f = path.join(d, `${agent}.md`);
  let bullets = [];
  if (existsSync(f)) bullets = splitLines(readText(f)).filter((l) => l.startsWith('- '));
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
const RESERVED_STEMS = new Set(['memory', 'readme']);

/**
 * `_existing_slugs` — slugs already stored. learn never CREATES one of these; it may only
 * update or archive it by name (`writeMemories`).
 */
export function existingSlugs(memDir) {
  return new Set(globMd(memDir).map(stem).filter((s) => !RESERVED_STEMS.has(s.toLowerCase())));
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
  writeText(p, text);
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
 * Rewrite MEMORY.md as the map: one line per topic file with its fact count.
 *
 * LINES THE MAP DID NOT GENERATE ARE CARRIED, so a note the user wrote into the index
 * survives. `dropFlat` also drops legacy flat fact pointers; a rebuild passes it because it
 * has just moved them into topic files. With no topic and nothing carried, the file goes
 * back to the seed.
 */
function writeMap(memDir, dropFlat) {
  const idx = path.join(memDir, 'MEMORY.md');
  const carried = (readLines(idx) ?? []).filter((l) => {
    const t = l.trim();
    return t && t !== MEMORY_SEED.trim() && t !== MAP_HINT && !MAP_LINE_RE.test(t)
      && !(dropFlat && FACT_LINE_RE.test(t));
  });
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
 * `_harness_tui_views._memory_drop_index` — remove the index line(s) naming `<name>.md`.
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
 * SUBSTRING, NOT PARSE, exactly as the reference is: any line containing `(<name>.md)` goes,
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
  try { writeMap(memDir, false); } catch { /* the reference swallows OSError here too */ }
}

/** Drop every line holding `needle`; the kept lines when something went, else null. */
function dropLines(p, needle) {
  const lines = readLines(p);
  if (!lines) return null;        // the reference's `except OSError: return`
  const keep = lines.filter((ln) => !ln.includes(needle));
  if (keep.length === lines.length) return null;
  try {
    writeText(p, `${keep.join('\n')}\n`);
  } catch { /* the reference swallows OSError here too */ }
  return keep;
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
