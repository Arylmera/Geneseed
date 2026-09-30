#!/usr/bin/env node
/**
 * Render an explain-changes report — one self-contained, offline HTML page that walks a human
 * through a diff before they commit it.
 *
 * WHY A SCRIPT AND NOT THE MODEL. The model writes only the narrative (the brief: intent,
 * risks, logical units). Every diff line on the page comes from `git diff`, run here, and is
 * escaped here. A model that retypes a diff pays output tokens in proportion to the diff and
 * can alter a line of the very thing under review; this file cannot.
 *
 * The script only READS git. It never touches the index or the working tree.
 *
 * Usage:
 *   node render_changes.mjs --brief <file.json> [--out <notebook-dir>] [--base <ref>]
 *   node render_changes.mjs --hash [--base <ref>]
 * Exit: 0 written (mismatches, if any, go to stderr and onto a banner) · 2 usage · 3 empty diff.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
export const MAX_FILE_LINES = 1500;

function git(cwd, args, input) {
  return execFileSync('git', ['-c', 'core.quotePath=false', ...args], {
    cwd, input, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function gitOr(cwd, args, fallback) {
  try { return git(cwd, args).trim(); } catch { return fallback; }
}

/**
 * Untracked files as the diff `git add` would produce. Read here rather than via `git add -N`,
 * which would write the index.
 */
function untrackedAsDiff(root) {
  const paths = git(root, ['ls-files', '--others', '--exclude-standard', '-z'])
    .split('\0').filter(Boolean);
  let out = '';
  for (const p of paths) {
    const buf = fs.readFileSync(path.join(root, p));
    out += `diff --git a/${p} b/${p}\nnew file mode 100644\n`;
    if (buf.includes(0)) { out += `Binary files /dev/null and b/${p} differ\n`; continue; }
    const text = buf.toString('utf8');
    if (!text) continue;
    const lines = text.split('\n');
    const noEol = lines[lines.length - 1] !== '';
    if (!noEol) lines.pop();
    out += `--- /dev/null\n+++ b/${p}\n@@ -0,0 +1,${lines.length} @@\n`
      + lines.map((l) => `+${l}`).join('\n') + '\n';
    if (noEol) out += '\\ No newline at end of file\n';
  }
  return out;
}

/** Staged if anything is staged (what the commit will hold), else the working tree. */
export function selectDiff(root, base) {
  const common = ['diff', '--no-color', '--no-ext-diff', '-M'];
  if (base) return { mode: `${base}...HEAD`, text: git(root, [...common, `${base}...HEAD`]) };
  const head = gitOr(root, ['rev-parse', '--verify', '-q', 'HEAD'], '') ? 'HEAD' : EMPTY_TREE;
  const staged = git(root, [...common, '--cached', head]);
  if (staged) return { mode: 'staged', text: staged };
  return { mode: 'working tree', text: git(root, [...common, head]) + untrackedAsDiff(root) };
}

export const diffHash = (text) => createHash('sha256').update(text).digest('hex').slice(0, 12);

export function parseDiff(text) {
  const files = [];
  let f = null;
  let h = null;
  let o = 0;
  let n = 0;
  for (const line of text.split('\n')) {
    if (line.startsWith('diff --git ')) {
      // ponytail: a path containing " b/" splits wrong here; the rename/copy lines correct it
      const m = /^diff --git a\/(.*) b\/(.*)$/.exec(line);
      f = {
        path: m ? m[2] : line.slice(11), oldPath: m ? m[1] : '', status: 'modified',
        binary: false, generated: false, truncated: false, hunks: [], add: 0, del: 0, shown: 0,
      };
      files.push(f);
      h = null;
      continue;
    }
    if (!f) continue;
    const hm = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hm) {
      h = { header: line, lines: [] };
      f.hunks.push(h);
      o = Number(hm[1]);
      n = Number(hm[2]);
      continue;
    }
    if (!h) {
      if (line.startsWith('new file mode')) f.status = 'added';
      else if (line.startsWith('deleted file mode')) f.status = 'deleted';
      else if (line.startsWith('rename from ')) { f.status = 'renamed'; f.oldPath = line.slice(12); }
      else if (line.startsWith('rename to ')) f.path = line.slice(10);
      else if (line.startsWith('copy from ')) { f.status = 'copied'; f.oldPath = line.slice(10); }
      else if (line.startsWith('copy to ')) f.path = line.slice(8);
      else if (line.startsWith('Binary files ') || line === 'GIT binary patch') f.binary = true;
      continue;
    }
    const t = line[0];
    if (t === '+') f.add++;
    else if (t === '-') f.del++;
    else if (t !== ' ' && t !== '\\') continue;
    if (f.shown >= MAX_FILE_LINES) { f.truncated = true; continue; }
    f.shown++;
    const body = line.slice(1);
    if (t === '+') h.lines.push({ t: 'add', n: n++, text: body });
    else if (t === '-') h.lines.push({ t: 'del', o: o++, text: body });
    else if (t === ' ') h.lines.push({ t: 'ctx', o: o++, n: n++, text: body });
    else h.lines.push({ t: 'note', text: line });
  }
  return files;
}

const GENERATED = /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock|Cargo\.lock|poetry\.lock|composer\.lock|Gemfile\.lock)$|(^|\/)dist\//;

export function markGenerated(root, files) {
  let attrs = '';
  try {
    attrs = git(root, ['check-attr', '--stdin', 'linguist-generated'],
      files.map((f) => f.path).join('\n') + '\n');
  } catch { /* no attributes → only the name patterns apply */ }
  const marked = new Set();
  for (const l of attrs.split('\n')) {
    const i = l.lastIndexOf(': linguist-generated: ');
    if (i > 0 && /: (true|set)$/.test(l)) marked.add(l.slice(0, i));
  }
  for (const f of files) f.generated = GENERATED.test(f.path) || marked.has(f.path);
}

/** Inline SVG from the model: no script, no handler, no foreign HTML, nothing outside the page. */
export function safeSvg(svg) {
  return /^\s*<svg[\s>/]/i.test(svg)
    && !/<script|<foreignObject|\son\w+\s*=|href\s*=\s*["'](?!#)|url\(\s*["']?(?!#)/i.test(svg);
}

export const unitFiles = (u) => [...new Set([...(u.files ?? []), ...Object.keys(u.hunks ?? {})])];

export function checkBrief(brief, files) {
  const problems = [];
  const byPath = new Map(files.map((f) => [f.path, f]));
  const covered = new Set();
  for (const u of brief.units ?? []) {
    for (const p of unitFiles(u)) {
      if (byPath.has(p)) covered.add(p);
      else problems.push(`unit "${u.title}" cites ${p}, which is not in the diff`);
    }
    for (const [p, idx] of Object.entries(u.hunks ?? {})) {
      const f = byPath.get(p);
      if (!f) continue;
      for (const i of idx) {
        if (!f.hunks[i]) problems.push(`unit "${u.title}" cites hunk ${i} of ${p}, which has ${f.hunks.length}`);
      }
    }
    if (u.svg && !safeSvg(u.svg)) problems.push(`unit "${u.title}": diagram dropped (unsafe SVG)`);
  }
  for (const f of files) {
    if (!covered.has(f.path) && !f.generated) problems.push(`${f.path} is changed but no unit explains it`);
  }
  if (!brief.risks?.length && !brief.risks_none_reason) {
    problems.push('no risks listed and no risks_none_reason given');
  }
  return problems;
}
