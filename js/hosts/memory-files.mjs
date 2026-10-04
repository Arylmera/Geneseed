/**
 * The memory store's file format — fact files with frontmatter, the `MEMORY.md` index, the
 * per-agent lesson files — read and written without spawning anything.
 *
 * SPLIT FROM `learn` FOR THE CLI's SAKE. `learn` spawns the model CLI, and the web console
 * (`js/web/api.mjs`, `js/web/actions.mjs`), `geneseed memory` (`js/maintain/memory.mjs`) and the
 * loop catalogue (`js/loop/catalog.mjs`) imported the hook module only for `frontmatter` and
 * `memoryDropIndex` — which dragged `node:child_process` into `bin/geneseed-cli.mjs`'s closure
 * and made the hook module a row in `tests/unit/hook_cli.test.mjs`'s spawn allow-list for a
 * spawn the CLI never makes. Everything here is fs-only; `hooks-learn.mjs` is the one spawner.
 */
import { existsSync, mkdirSync } from 'node:fs';
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

/** `_existing_slugs` — slugs already stored, so learn never re-emits a known fact. */
export function existingSlugs(memDir) {
  const skip = new Set(['memory', 'readme']);
  return new Set(globMd(memDir).map(stem).filter((s) => !skip.has(s.toLowerCase())));
}

/**
 * `_write_memories` — split the model output into files, write each NEW one, and append a
 * pointer line to MEMORY.md. `existing` is MUTATED, so a reply carrying the same slug
 * twice writes it once.
 */
export function writeMemories(modelOutput, memDir, existing) {
  const written = [];
  const indexLines = [];
  for (let chunk of modelOutput.split(FILE_SEP_RE)) {
    chunk = chunk.trim();
    if (!chunk || chunk.toUpperCase() === 'NOTHING') continue;
    const [fm] = frontmatter(chunk);
    const name = fmGet(fm, 'name').trim();
    if (!MEMORY_SLUG_RE.test(name) || existing.has(name)) continue;
    writeText(path.join(memDir, `${name}.md`), `${chunk.replace(/\n+$/, '')}\n`);
    existing.add(name);
    written.push(name);
    const desc = fmGet(fm, 'description').trim();
    indexLines.push(`- [${name}](${name}.md)${desc ? ` \u2014 ${desc}` : ''}`);
  }
  if (indexLines.length) {
    const index = path.join(memDir, 'MEMORY.md');
    const current = existsSync(index) ? `${readText(index).replace(/\n+$/, '')}\n`
      : '# Memory Index\n';
    writeText(index, `${current}${indexLines.join('\n')}\n`);
  }
  return written;
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
 */
export function memoryDropIndex(memDir, name) {
  const idx = path.join(memDir, 'MEMORY.md');
  let lines;
  try {
    lines = splitLines(readText(idx));
  } catch {
    return;                       // the reference's `except OSError: return`
  }
  const keep = lines.filter((ln) => !ln.includes(`(${name}.md)`));
  if (keep.length === lines.length) return;
  try {
    writeText(idx, `${keep.join('\n')}\n`);
  } catch { /* the reference swallows OSError here too */ }
}

/**
 * `consolidate_memory` — rebuild MEMORY.md from the fact files actually on disk: index
 * orphans, prune dead lines, report duplicate descriptions (never auto-merge — nuance is
 * the user's to keep).
 */
export function consolidateMemory(memDir) {
  const skip = new Set(['memory', 'readme']);
  const facts = new Map();
  for (const name of sortPaths(globMd(memDir))) {
    const s = stem(name);
    if (skip.has(s.toLowerCase())) continue;
    try {
      facts.set(s, fmGet(frontmatter(readText(path.join(memDir, name)))[0], 'description').trim());
    } catch { continue; }
  }
  const index = path.join(memDir, 'MEMORY.md');
  const oldSlugs = new Set();
  if (existsSync(index)) {
    for (const line of splitLines(readText(index))) {
      const m = /^- \[[^\]]*\]\(([^)]+)\.md\)/.exec(line.trim());
      if (m) oldSlugs.add(m[1]);
    }
  }
  const lines = ['# Memory Index', ''];
  for (const [slug, desc] of facts) {
    lines.push(`- [${slug}](${slug}.md)${desc ? ` \u2014 ${desc}` : ''}`);
  }
  writeText(index, `${lines.join('\n')}\n`);
  const seen = new Map();
  const dups = [];
  for (const [slug, desc] of facts) {
    if (desc && seen.has(desc)) dups.push([seen.get(desc), slug]);
    if (!seen.has(desc)) seen.set(desc, slug);
  }
  const added = [...facts.keys()].filter((s) => !oldSlugs.has(s)).sort();
  const pruned = [...oldSlugs].filter((s) => !facts.has(s)).sort();
  return { added, pruned, duplicates: dups };
}
